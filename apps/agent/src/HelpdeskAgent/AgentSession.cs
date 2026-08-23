using Microsoft.Extensions.Logging;
using SIPSorcery.Net;

namespace HelpdeskAgent;

/// <summary>
/// Phase 2 core: SIPSorcery WebRTC peer answering the technician browser.
/// The browser is the offerer (creates the DataChannel); the agent answers,
/// opens the DataChannel, and exchanges test messages in both directions.
/// </summary>
public sealed class AgentSession : IAsyncDisposable
{
    private readonly ILogger _log;
    private readonly SignallingClient _signalling;
    private RTCPeerConnection? _pc;
    private RTCDataChannel? _dc;

    private readonly List<IceCandidatePayload> _pendingRemoteIce = new();
    private bool _remoteDescriptionSet;

    public event Action<string>? OnChatReceived;
    public event Action<RTCPeerConnectionState>? ConnectionStateChanged;

    public RTCPeerConnectionState State { get; private set; } = RTCPeerConnectionState.@new;
    public bool DataChannelOpen => _dc?.IsOpened ?? false;

    public AgentSession(SignallingClient signalling, ILogger log)
    {
        _log = log;
        _signalling = signalling;

        _signalling.OnSdp += sdp => _ = HandleRemoteSdpAsync(sdp.Sdp);
        _signalling.OnIce += cand => _ = HandleRemoteIceAsync(cand.Candidate);
        _signalling.OnPeerLeft += _ => Close("peer left");
    }

    public Task StartAsync(CancellationToken ct)
    {
        EnsurePeerConnection();
        return _signalling.ConnectAsync(ct);
    }

    private void EnsurePeerConnection()
    {
        if (_pc is not null) return;

        var config = new RTCConfiguration
        {
            iceServers = new List<RTCIceServer>
            {
                new() { urls = Environment.GetEnvironmentVariable("STUN_URL") ?? "stun:stun.l.google.com:19302" },
            },
        };
        // TURN support (Phase 6): TURN_URL / TURN_USERNAME / TURN_CREDENTIAL
        var turnUrl = Environment.GetEnvironmentVariable("TURN_URL");
        if (!string.IsNullOrWhiteSpace(turnUrl))
        {
            var server = new RTCIceServer { urls = turnUrl };
            var user = Environment.GetEnvironmentVariable("TURN_USERNAME");
            var cred = Environment.GetEnvironmentVariable("TURN_CREDENTIAL");
            if (!string.IsNullOrWhiteSpace(user) && !string.IsNullOrWhiteSpace(cred))
            {
                server.username = user;
                server.credential = cred;
                server.credentialType = RTCIceCredentialType.password;
            }
            config.iceServers.Add(server);
            _log.LogInformation("TURN configured: {Url}", turnUrl);
        }

        var pc = new RTCPeerConnection(config);
        _pc = pc;

        pc.onconnectionstatechange += (state) =>
        {
            State = state;
            _log.LogInformation("WebRTC connection state: {State}", state);
            ConnectionStateChanged?.Invoke(state);
            if (state is RTCPeerConnectionState.failed or RTCPeerConnectionState.closed)
            {
                Close($"connection {state}");
            }
        };

        pc.oniceconnectionstatechange += (state) =>
            _log.LogInformation("ICE connection state: {State}", state);

        // Non-trickle friendly: relay any candidates SIPSorcery surfaces after
        // the local description (most candidates are embedded in the SDP).
        pc.onicecandidate += (candidate) =>
        {
            if (candidate?.candidate is null) return;
            _ = _signalling.SendIceAsync(new IceCandidatePayload(
                candidate.candidate,
                candidate.sdpMid,
                candidate.sdpMLineIndex));
        };

        pc.ondatachannel += (channel) =>
        {
            _log.LogInformation("DataChannel created by remote peer: {Label}", channel.label);
            BindDataChannel(channel);
        };

        _log.LogInformation("SIPSorcery RTCPeerConnection created (SIPSorcery validation)");
    }

    private void BindDataChannel(RTCDataChannel channel)
    {
        _dc = channel;
        Action hello = () =>
        {
            _log.LogInformation("DataChannel OPEN (label={Label}, id={Id})", channel.label, channel.id);
            // Endpoint → browser test message (Phase 2 criterion).
            SendChat("endpoint agent connected — DataChannel open");
        };
        // SIPSorcery may hand over remote-created channels that are already open,
        // in which case onopen never fires — greet immediately in that case.
        if (channel.IsOpened) hello();
        channel.onopen += hello;
        channel.onclose += () => _log.LogWarning("DataChannel closed");
        channel.onmessage += (dc, protocol, data) =>
        {
            switch (protocol)
            {
                case DataChannelPayloadProtocols.WebRTC_String:
                case DataChannelPayloadProtocols.WebRTC_String_Partial:
                    HandleControlMessage(System.Text.Encoding.UTF8.GetString(data));
                    break;
                case DataChannelPayloadProtocols.WebRTC_String_Empty:
                    HandleControlMessage(string.Empty);
                    break;
                default:
                    _log.LogDebug("binary DataChannel message ({Len} bytes) ignored", data.Length);
                    break;
            }
        };
    }

    private void HandleControlMessage(string message)
    {
        _log.LogDebug("DC message: {Msg}", message);
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(message);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl)) return;
            switch (typeEl.GetString())
            {
                case "chat":
                {
                    var text = root.TryGetProperty("text", out var t) ? t.GetString() : "";
                    _log.LogInformation("[chat from technician] {Text}", text);
                    OnChatReceived?.Invoke(text ?? "");
                    break;
                }
                case "mouse_move":
                case "mouse_click":
                case "mouse_wheel":
                case "key":
                    // Phase 4 will dispatch these to SendInput.
                    _log.LogTrace("control message {Type} (input injection not yet active)", typeEl.GetString());
                    break;
                default:
                    _log.LogDebug("unknown control message type {Type}", typeEl.GetString());
                    break;
            }
        }
        catch (System.Text.Json.JsonException)
        {
            _log.LogWarning("non-JSON DataChannel message ignored");
        }
    }

    public bool SendChat(string text)
    {
        var dc = _dc;
        if (dc is not { IsOpened: true }) return false;
        var payload = $$"""{"type":"chat","text":{{System.Text.Json.JsonSerializer.Serialize(text)}},"ts":{{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}},"from":"endpoint"}""";
        dc.send(payload);
        return true;
    }

    private async Task HandleRemoteSdpAsync(SdpPayload sdp)
    {
        try
        {
            EnsurePeerConnection();
            var pc = _pc!;
            var remote = new RTCSessionDescriptionInit
            {
                type = sdp.Type == "offer" ? RTCSdpType.offer : RTCSdpType.answer,
                sdp = sdp.Sdp,
            };

            var setResult = pc.setRemoteDescription(remote);
            if (setResult != SetDescriptionResultEnum.OK)
            {
                _log.LogError("setRemoteDescription failed: {Result}", setResult);
                return;
            }
            _remoteDescriptionSet = true;
            await DrainPendingIceAsync();

            if (sdp.Type == "offer")
            {
                var answer = pc.createAnswer();
                pc.setLocalDescription(answer);
                var sdpText = pc.localDescription?.sdp?.ToString() ?? "";
                _log.LogInformation("answer ready, SDP length {Len}", sdpText.Length);
                await _signalling.SendSdpAsync(new SdpPayload("answer", sdpText));
            }
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "failed handling remote SDP");
        }
    }

    private async Task HandleRemoteIceAsync(IceCandidatePayload candidate)
    {
        try
        {
            if (!_remoteDescriptionSet)
            {
                _pendingRemoteIce.Add(candidate);
                return;
            }
            var init = new RTCIceCandidateInit
            {
                candidate = candidate.Candidate,
                sdpMid = candidate.SdpMid,
                sdpMLineIndex = (ushort)(candidate.SdpMLineIndex ?? 0),
            };
            _pc!.addIceCandidate(init);
            await Task.CompletedTask;
        }
        catch (Exception ex)
        {
            _log.LogDebug("addIceCandidate failed (often harmless for trickle dupes): {Msg}", ex.Message);
        }
    }

    private async Task DrainPendingIceAsync()
    {
        var pc = _pc!;
        foreach (var cand in _pendingRemoteIce)
        {
            try
            {
                pc.addIceCandidate(new RTCIceCandidateInit
                {
                    candidate = cand.Candidate,
                    sdpMid = cand.SdpMid,
                    sdpMLineIndex = (ushort)(cand.SdpMLineIndex ?? 0),
                });
                await Task.CompletedTask;
            }
            catch (Exception ex)
            {
                _log.LogDebug("drain addIceCandidate error: {Msg}", ex.Message);
            }
        }
        _pendingRemoteIce.Clear();
    }

    public void Close(string reason)
    {
        _log.LogInformation("closing agent session: {Reason}", reason);
        try
        {
            _dc?.close();
        }
        catch { /* already closed */ }
        try
        {
            _pc?.Close("session ended");
        }
        catch { /* already closed */ }
        _pc = null;
        _dc = null;
    }

    public async ValueTask DisposeAsync()
    {
        Close("disposed");
        await _signalling.DisposeAsync();
    }
}

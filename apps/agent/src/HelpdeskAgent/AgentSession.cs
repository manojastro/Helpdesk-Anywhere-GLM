using Microsoft.Extensions.Logging;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;
using Vpx.Net;

namespace HelpdeskAgent;

/// <summary>
/// SIPSorcery WebRTC peer answering the technician browser.
/// The browser is the offerer (creates the DataChannel); the agent answers,
/// opens the DataChannel, streams the desktop over a VP8 video track, and
/// exchanges chat/control messages in both directions.
/// </summary>
public sealed class AgentSession : IAsyncDisposable
{
    private readonly ILogger _log;
    private readonly SignallingClient _signalling;
    private RTCPeerConnection? _pc;
    private RTCDataChannel? _dc;

    private DesktopDuplicator? _capture;
    private GdiCapture? _gdiCapture;
    private readonly InputInjector _input;
    private Vp8NetVideoEncoderEndPoint? _videoSource;
    private long _framesSent;
    private long _encodedCount;
    private int _lastEncodedSize;
    private long _lastLoggedFrames;

    private readonly List<IceCandidatePayload> _pendingRemoteIce = new();
    private bool _remoteDescriptionSet;

    public event Action<string>? OnChatReceived;
    public event Action<RTCPeerConnectionState>? ConnectionStateChanged;

    public RTCPeerConnectionState State { get; private set; } = RTCPeerConnectionState.@new;
    public bool DataChannelOpen => _dc?.IsOpened ?? false;
    public long FramesCaptured => _framesSent;
    public long EncodedCount => _encodedCount;
    public int LastEncodedSize => _lastEncodedSize;
    public long InjectedInputs => _input.InjectedCount;

    public AgentSession(SignallingClient signalling, ILogger log)
    {
        _log = log;
        _signalling = signalling;
        _input = new InputInjector(log);

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
            if (state == RTCPeerConnectionState.connected)
            {
                StartScreenCapture();
            }
            else if (state is RTCPeerConnectionState.failed or RTCPeerConnectionState.closed)
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

        // ---- Phase 3: desktop video track (VP8, SIPSorceryMedia.Encoders) ----
        if (Environment.GetEnvironmentVariable("HA_NO_VIDEO") != "1")
        {
            _videoSource = new Vp8NetVideoEncoderEndPoint();
            _videoSource.RestrictFormats(f => f.Codec == VideoCodecsEnum.VP8);
            var videoTrack = new MediaStreamTrack(
                _videoSource.GetVideoSourceFormats(), MediaStreamStatusEnum.SendOnly);
            pc.addTrack(videoTrack);
            _videoSource.OnVideoSourceEncodedSample += (durationRtpUnits, sample) =>
            {
                _encodedCount++;
                _lastEncodedSize = sample.Length;
                pc.SendVideo(durationRtpUnits, sample);
            };
            pc.OnVideoFormatsNegotiated += formats =>
                _videoSource.SetVideoSourceFormat(formats.First());
            _log.LogInformation("VP8 video track added (DXGI desktop capture source)");
        }

        _log.LogInformation("SIPSorcery RTCPeerConnection created (SIPSorcery validation)");
    }

    private void StartScreenCapture()
    {
        if (_capture is not null || _gdiCapture is not null) return;
        var mode = Environment.GetEnvironmentVariable("HA_CAPTURE") ?? "auto";
        if (mode == "gdi")
        {
            StartGdiCapture("forced by HA_CAPTURE=gdi");
            return;
        }
        try
        {
            var fps = int.TryParse(Environment.GetEnvironmentVariable("HA_FPS"), out var f) ? f : 8;
            var capture = new DesktopDuplicator(_log, fps);
            var blackFrames = 0;
            const int blackThreshold = 3;
            capture.OnFrame += (w, h, stride, pixels) =>
            {
                // DXGI duplication yields black frames in some remote sessions
                // (classic RDP limitation) — detect and fall back to GDI BitBlt.
                if (blackFrames >= 0 && blackFrames < blackThreshold)
                {
                    if (IsUniformlyBlack(pixels))
                    {
                        blackFrames++;
                        _log.LogWarning("DXGI frame {N} is uniformly black", blackFrames);
                        if (blackFrames >= blackThreshold)
                        {
                            blackFrames = -1; // signal: switch
                            StopDxgiCapture(capture);
                            StartGdiCapture("DXGI produced black frames (remote session?)");
                            return;
                        }
                    }
                    else
                    {
                        blackFrames = -1; // content confirmed
                    }
                }
                FeedVideoFrame(w, h, stride, pixels, fps);
            };
            capture.Initialise();
            capture.Start();
            _capture = capture;
            _log.LogInformation("screen capture started: DXGI ({W}x{H})", capture.Width, capture.Height);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "DXGI desktop capture failed to start — trying GDI");
            StartGdiCapture("DXGI init failed");
        }
    }

    private void StopDxgiCapture(DesktopDuplicator capture)
    {
        try
        {
            capture.Stop();
            capture.Dispose();
        }
        catch { /* shutting down */ }
        if (ReferenceEquals(_capture, capture)) _capture = null;
    }

    private void StartGdiCapture(string reason)
    {
        try
        {
            var fps = int.TryParse(Environment.GetEnvironmentVariable("HA_FPS"), out var f) ? f : 8;
            _log.LogInformation("switching to GDI capture: {Reason}", reason);
            var gdi = new GdiCapture(_log, fps);
            gdi.OnFrame += (w, h, stride, pixels) => FeedVideoFrame(w, h, stride, pixels, fps);
            gdi.Initialise();
            gdi.Start();
            _gdiCapture = gdi;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "GDI capture failed too — no video");
        }
    }

    private static bool IsUniformlyBlack(byte[] pixels)
    {
        // Sample BGRA bytes, skipping alpha. ~16k samples spread over the frame.
        var step = Math.Max(16, pixels.Length / 16384) * 4;
        for (var i = 0; i + 2 < pixels.Length; i += step)
        {
            if (pixels[i] != 0 || pixels[i + 1] != 0 || pixels[i + 2] != 0) return false;
        }
        return true;
    }

    private void FeedVideoFrame(int w, int h, int stride, byte[] pixels, int fps)
    {
        var source = _videoSource;
        if (source is null) return;

        // Downscale by an integer factor to cap bandwidth (no bitrate API on
        // the managed VP8 encoder), then crop to multiples of 16.
        var maxWidth = int.TryParse(Environment.GetEnvironmentVariable("HA_MAX_WIDTH"), out var mw) ? mw : 1280;
        var factor = Math.Max(1, (int)Math.Ceiling(w / (double)maxWidth));
        var w16 = (w / factor) & ~15;
        var h16 = (h / factor) & ~15;
        if (w16 == 0 || h16 == 0) return;

        var rowLen = w16 * 4;
        byte[] tight;
        if (factor == 1 && stride == rowLen && w16 == w)
        {
            tight = pixels;
        }
        else
        {
            tight = new byte[rowLen * h16];
            if (factor == 1)
            {
                for (var y = 0; y < h16; y++)
                {
                    Buffer.BlockCopy(pixels, y * stride, tight, y * rowLen, rowLen);
                }
            }
            else
            {
                // Nearest-neighbour subsample (cheap; POC quality is fine).
                for (var y = 0; y < h16; y++)
                {
                    var srcRow = (y * factor) * stride;
                    for (var x = 0; x < w16; x++)
                    {
                        var src = srcRow + (x * factor) * 4;
                        tight[y * rowLen + x * 4] = pixels[src];
                        tight[y * rowLen + x * 4 + 1] = pixels[src + 1];
                        tight[y * rowLen + x * 4 + 2] = pixels[src + 2];
                        tight[y * rowLen + x * 4 + 3] = pixels[src + 3];
                    }
                }
            }
        }
        source.ExternalVideoSourceRawSample(
            (uint)(1000.0 / fps), w16, h16, tight, VideoPixelFormatsEnum.Bgra);
        _framesSent++;
    }

    private void BindDataChannel(RTCDataChannel channel)
    {
        _dc = channel;
        Action hello = () =>
        {
            _log.LogInformation("DataChannel OPEN (label={Label}, id={Id})", channel.label, channel.id);
            SendChat("endpoint agent connected — DataChannel open");
        };
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
                {
                    var x = root.TryGetProperty("x", out var xe) ? xe.GetDouble() : -1;
                    var y = root.TryGetProperty("y", out var ye) ? ye.GetDouble() : -1;
                    if (x is >= 0.0 and <= 1.0 && y is >= 0.0 and <= 1.0)
                    {
                        _input.MouseMove(x, y);
                    }
                    break;
                }
                case "mouse_click":
                {
                    var button = root.TryGetProperty("button", out var b) ? b.GetString() : "left";
                    var state = root.TryGetProperty("state", out var st) ? st.GetString() : "down";
                    _input.MouseClick(button ?? "left", state == "down");
                    break;
                }
                case "mouse_wheel":
                {
                    var delta = root.TryGetProperty("delta", out var d) ? d.GetDouble() : 0;
                    _input.MouseWheel(delta);
                    break;
                }
                case "key":
                {
                    var code = root.TryGetProperty("code", out var c) ? c.GetString() : "";
                    var state = root.TryGetProperty("state", out var st2) ? st2.GetString() : "down";
                    if (!string.IsNullOrEmpty(code)) _input.Key(code, state == "down");
                    break;
                }
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
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            type = "chat",
            text,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            from = "endpoint",
        });
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
        _log.LogInformation("closing agent session: {Reason} (frames captured: {Frames})", reason, _framesSent);
        try
        {
            _capture?.Stop();
            _capture?.Dispose();
        }
        catch { /* already disposed */ }
        _capture = null;
        try
        {
            _gdiCapture?.Stop();
            _gdiCapture?.Dispose();
        }
        catch { /* already disposed */ }
        _gdiCapture = null;
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

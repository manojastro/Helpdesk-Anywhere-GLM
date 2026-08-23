using System.Text.Json;
using Microsoft.Extensions.Logging;
using SocketIOClient;

namespace HelpdeskAgent;

/// <summary>
/// socket.io signalling client (event names locked — see SignallingProtocol.cs).
/// Relays SDP/ICE between the backend and the WebRTC session.
/// </summary>
public sealed class SignallingClient : IAsyncDisposable
{
    private readonly SocketIO _socket;
    private readonly ILogger _log;
    private readonly string _sessionId;

    public event Action<RelaySdpPayload>? OnSdp;
    public event Action<RelayIcePayload>? OnIce;
    public event Action<string>? OnPeerJoined;
    public event Action<string>? OnPeerLeft;
    public event Action<string>? OnError;
    public event Action? OnDisconnected;

    public SignallingClient(string serverUrl, string sessionId, string signallingToken, ILogger log)
    {
        _log = log;
        _sessionId = sessionId;

        var uri = new Uri(serverUrl);
        _socket = new SocketIO(uri, new SocketIOOptions
        {
            Path = "/socket.io",
            Reconnection = true,
            ReconnectionAttempts = 10,
            EIO = SocketIOClient.Common.EngineIO.V4,
        });

        _socket.OnConnected += async (_, _) =>
        {
            _log.LogInformation("signalling socket connected, joining session {Id}…", sessionId);
            await _socket.EmitAsync(
                SignalEvents.Join,
                new object[] { new SignalJoinPayload(sessionId, "endpoint", signallingToken) },
                async (ack) =>
                {
                    var result = ack.GetValue<JoinAck>(0);
                    if (result is { Ok: true })
                    {
                        _log.LogInformation("signal:join accepted, peers in room: {Peers}",
                            result.Peers is { Count: > 0 } ? string.Join(",", result.Peers) : "(none)");
                    }
                    else
                    {
                        _log.LogError("signal:join REJECTED: {Error}", result?.Error ?? "unknown");
                        OnError?.Invoke(result?.Error ?? "join rejected");
                    }
                });
        };

        _socket.On(SignalEvents.Sdp, (resp) =>
        {
            var payload = resp.GetValue<RelaySdpPayload>(0);
            _log.LogInformation("received SDP {Type} from {From}", payload.Sdp.Type, payload.From);
            OnSdp?.Invoke(payload);
            return Task.CompletedTask;
        });

        _socket.On(SignalEvents.Ice, (resp) =>
        {
            var payload = resp.GetValue<RelayIcePayload>(0);
            _log.LogDebug("received ICE candidate from {From}", payload.From);
            OnIce?.Invoke(payload);
            return Task.CompletedTask;
        });

        _socket.On(SignalEvents.PeerJoined, (resp) =>
        {
            var payload = resp.GetValue<PeerEventPayload>(0);
            _log.LogInformation("peer joined: {Peer}", payload.Peer);
            OnPeerJoined?.Invoke(payload.Peer ?? "?");
            return Task.CompletedTask;
        });

        _socket.On(SignalEvents.PeerLeft, (resp) =>
        {
            var payload = resp.GetValue<PeerEventPayload>(0);
            _log.LogInformation("peer left: {Peer}", payload.Peer);
            OnPeerLeft?.Invoke(payload.Peer ?? "?");
            return Task.CompletedTask;
        });

        _socket.On(SignalEvents.Error, (resp) =>
        {
            var payload = resp.GetValue<SignalErrorPayload>(0);
            _log.LogWarning("signalling error: {Msg}", payload.Message);
            OnError?.Invoke(payload.Message);
            return Task.CompletedTask;
        });

        _socket.OnDisconnected += (_, _) =>
        {
            _log.LogWarning("signalling socket disconnected");
            OnDisconnected?.Invoke();
        };
    }

    public Task ConnectAsync(CancellationToken ct) => _socket.ConnectAsync();

    public async Task SendSdpAsync(SdpPayload sdp)
    {
        var payload = new Dictionary<string, object>
        {
            ["sessionId"] = _sessionId,
            ["sdp"] = new Dictionary<string, object> { ["type"] = sdp.Type, ["sdp"] = sdp.Sdp },
        };
        await _socket.EmitAsync(SignalEvents.Sdp, new object[] { payload });
        _log.LogInformation("sent SDP {Type}", sdp.Type);
    }

    public async Task SendIceAsync(IceCandidatePayload candidate)
    {
        var payload = new Dictionary<string, object>
        {
            ["sessionId"] = _sessionId,
            ["candidate"] = new Dictionary<string, object?>
            {
                ["candidate"] = candidate.Candidate,
                ["sdpMid"] = candidate.SdpMid,
                ["sdpMLineIndex"] = candidate.SdpMLineIndex,
            },
        };
        await _socket.EmitAsync(SignalEvents.Ice, new object[] { payload });
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await _socket.DisconnectAsync();
        }
        catch
        {
            // socket may already be gone
        }
        _socket.Dispose();
    }
}

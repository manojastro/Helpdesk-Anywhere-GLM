using System.Text.Json.Serialization;

namespace HelpdeskAgent;

/// <summary>
/// C# mirror of packages/shared/src/signalling.ts — the locked protocol contract.
/// Keep in sync with docs/signalling-protocol.md.
/// </summary>
public static class SignalEvents
{
    public const string Join = "signal:join";
    public const string Sdp = "signal:sdp";
    public const string Ice = "signal:ice";
    public const string Joined = "signal:joined";
    public const string PeerJoined = "signal:peer-joined";
    public const string PeerLeft = "signal:peer-left";
    public const string Error = "signal:error";
}

public sealed record SignalJoinPayload(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("token")] string Token);

public sealed record JoinAck(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("peers")] List<string>? Peers,
    [property: JsonPropertyName("error")] string? Error);

public sealed record SdpPayload(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("sdp")] string Sdp);

public sealed record SignalSdpPayload(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("sdp")] SdpPayload Sdp);

public sealed record RelaySdpPayload(
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("sdp")] SdpPayload Sdp);

public sealed record IceCandidatePayload(
    [property: JsonPropertyName("candidate")] string Candidate,
    [property: JsonPropertyName("sdpMid")] string? SdpMid,
    [property: JsonPropertyName("sdpMLineIndex")] int? SdpMLineIndex);

public sealed record SignalIcePayload(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("candidate")] IceCandidatePayload Candidate);

public sealed record RelayIcePayload(
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("candidate")] IceCandidatePayload Candidate);

public sealed record PeerEventPayload(
    [property: JsonPropertyName("sessionId")] string? SessionId,
    [property: JsonPropertyName("peer")] string? Peer);

public sealed record SignalErrorPayload(
    [property: JsonPropertyName("message")] string Message);

// ---- REST contracts ----

public sealed record SessionDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("status")] string Status);

public sealed record JoinSessionRequest(
    [property: JsonPropertyName("joinToken")] string JoinToken,
    [property: JsonPropertyName("role")] string Role);

public sealed record JoinSessionResponse(
    [property: JsonPropertyName("session")] SessionDto Session,
    [property: JsonPropertyName("signallingToken")] string SignallingToken);

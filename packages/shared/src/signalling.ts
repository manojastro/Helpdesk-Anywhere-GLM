/**
 * Signalling protocol contracts shared by backend and web client.
 *
 * Event names are LOCKED per docs/signalling-protocol.md — do not rename.
 * The C# endpoint agent mirrors these in apps/agent/src/HelpdeskAgent/SignallingProtocol.cs.
 */

export const SIGNAL_EVENTS = {
  join: 'signal:join',
  sdp: 'signal:sdp',
  ice: 'signal:ice',
  joined: 'signal:joined',
  peerJoined: 'signal:peer-joined',
  peerLeft: 'signal:peer-left',
  error: 'signal:error',
} as const;

export type PeerRole = 'technician' | 'endpoint';

export interface SdpPayload {
  type: 'offer' | 'answer';
  sdp: string;
}

/** RTCIceCandidateInit-compatible relay payload. */
export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// ---- Client → server ----

export interface SignalJoinPayload {
  sessionId: string;
  role: PeerRole;
  /** Short-lived JWT obtained from POST /sessions/:code/join */
  token: string;
}

export interface SignalSdpPayload {
  sessionId: string;
  sdp: SdpPayload;
}

export interface SignalIcePayload {
  sessionId: string;
  candidate: IceCandidatePayload;
}

// ---- Server → client ----

export interface SignalJoinedPayload {
  sessionId: string;
  role: PeerRole;
  /** Roles+socket ids of peers already in the room, e.g. "technician:abc". */
  peers: string[];
}

export interface SignalPeerJoinedPayload {
  sessionId: string;
  peer: string;
}

export interface SignalPeerLeftPayload {
  sessionId: string;
  peer: string;
}

export interface SignalRelaySdpPayload {
  from: string;
  sdp: SdpPayload;
}

export interface SignalRelayIcePayload {
  from: string;
  candidate: IceCandidatePayload;
}

export interface SignalErrorPayload {
  message: string;
}

// ---- Session REST contracts ----

export type SessionStatus = 'waiting' | 'active' | 'ended';

export interface SessionDto {
  id: string;
  code: string;
  status: SessionStatus;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
}

export interface DevLoginRequest {
  email: string;
  displayName?: string;
}

export interface DevLoginResponse {
  accessToken: string;
  technician: { id: string; email: string; displayName: string };
}

export interface CreateSessionResponse {
  session: SessionDto;
  /** Short-lived join token handed to the endpoint user. */
  joinToken: string;
}

export interface JoinSessionRequest {
  joinToken: string;
  role: PeerRole;
}

export interface JoinSessionResponse {
  session: SessionDto;
  /** JWT authorizing the signalling socket handshake. */
  signallingToken: string;
}

export interface SessionEventDto {
  id: string;
  sessionId: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

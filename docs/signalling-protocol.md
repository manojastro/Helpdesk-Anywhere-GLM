# Signalling Protocol

This documents the **actual implemented** signalling protocol. Event names are
locked; do not rename them to match illustrative specs.

The authoritative TypeScript contract lives in `packages/shared/src/signalling.ts`
and is mirrored by the C# models in `apps/agent` (`SignallingProtocol.cs`).

## Transport

- REST (HTTP JSON) for session lifecycle: create / join / end.
- socket.io WebSocket for signalling relay: SDP + ICE exchange only.

## REST endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/dev-login` | `{ email, displayName? }` | `{ accessToken, technician }` |
| POST | `/sessions` (Bearer) | `{}` | `{ session }` with `code` + `joinToken` |
| POST | `/sessions/:code/join` | `{ joinToken, role }` | `{ session, signallingToken }` |
| POST | `/sessions/:code/end` (Bearer) | `{}` | `{ session }` |
| GET  | `/sessions/:code` (Bearer) | — | `{ session, events }` |

- `role` is `technician` or `endpoint`.
- `joinToken` is short-lived (default 15 min) and single-use-per-role.
- `signallingToken` (JWT) authorizes the socket.io `signal:join` handshake.

## socket.io events

### Client → server

#### `signal:join`

```json
{ "sessionId": "uuid", "role": "technician" | "endpoint", "token": "signalling-jwt" }
```

Server validates the token, verifies session membership, and places the socket
in the session room. Responses: `signal:joined` (ack) or `signal:error`.

#### `signal:sdp`

```json
{ "sessionId": "uuid", "sdp": { "type": "offer" | "answer", "sdp": "..." } }
```

Relayed to the other peer in the session as `signal:sdp` with `{ from, sdp }`.

#### `signal:ice`

```json
{ "sessionId": "uuid", "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 } }
```

Relayed to the other peer as `signal:ice` with `{ from, candidate }`.

### Server → client

#### `signal:joined`

Ack emitted to the joining socket: `{ sessionId, role, peers: ["role:socketId", ...] }`

#### `signal:peer-joined`

```json
{ "sessionId": "role", "peer": "endpoint:abc123" }
```

Emitted to the peer already in the room when a second peer joins.

#### `signal:peer-left`

```json
{ "sessionId": "...", "peer": "endpoint:abc123" }
```

Emitted when the other peer disconnects (socket disconnect or session end).

#### `signal:sdp` / `signal:ice`

Relayed payload (see above), always tagged with `from` identifying sender
role and socket id.

#### `signal:error`

```json
{ "message": "human readable reason" }
```

## Rules

- Exactly two peers per session for the POC: one `technician`, one `endpoint`.
- A second socket claiming an already-occupied role is rejected.
- The backend relays SDP/ICE only; it never inspects media and never carries
  screen/video payloads.
- SDP/ICE is not persisted. Session/audit events record lifecycle facts only.

## DataChannel control protocol (over WebRTC, not signalling)

Carried on the reliable DataChannel, JSON encoded:

```json
{ "type": "chat", "text": "hello", "ts": 1690000000000 }
{ "type": "mouse_move", "x": 0.45, "y": 0.62 }
{ "type": "mouse_click", "button": "left" | "right" | "middle", "state": "down" | "up" }
{ "type": "mouse_wheel", "delta": -120 }
{ "type": "key", "code": "KeyA", "state": "down" | "up" }
```

- Coordinates are normalized `0.0–1.0` relative to the captured desktop.
- Keyboard `code` uses browser `KeyboardEvent.code` values, mapped to Windows
  virtual-key codes by the endpoint agent.

import { io, type Socket } from 'socket.io-client';
import {
  SIGNAL_EVENTS,
  type IceCandidatePayload,
  type PeerRole,
  type SdpPayload,
} from '@helpdesk/shared';

export interface SignallingCallbacks {
  onPeerJoined?: (peer: string) => void;
  onPeerLeft?: (peer: string) => void;
  onSdp?: (from: string, sdp: SdpPayload) => void;
  onIce?: (from: string, candidate: IceCandidatePayload) => void;
  onError?: (message: string) => void;
  onDisconnect?: (reason: string) => void;
}

/** socket.io signalling client. Event names are locked (docs/signalling-protocol.md). */
export class SignallingClient {
  private readonly sock: Socket;

  constructor(
    sessionId: string,
    role: PeerRole,
    token: string,
    private readonly cb: SignallingCallbacks,
  ) {
    this.sock = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { sessionId, role },
    });

    this.sock.on('connect', () => {
      void this.sock
        .emitWithAck(SIGNAL_EVENTS.join, { sessionId, role, token })
        .then((ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) this.cb.onError?.(ack?.error ?? 'join rejected');
        })
        .catch((err: Error) => this.cb.onError?.(err.message));
    });

    this.sock.on(SIGNAL_EVENTS.peerJoined, (p: { peer: string }) => this.cb.onPeerJoined?.(p.peer));
    this.sock.on(SIGNAL_EVENTS.peerLeft, (p: { peer: string }) => this.cb.onPeerLeft?.(p.peer));
    this.sock.on(SIGNAL_EVENTS.sdp, (p: { from: string; sdp: SdpPayload }) =>
      this.cb.onSdp?.(p.from, p.sdp),
    );
    this.sock.on(SIGNAL_EVENTS.ice, (p: { from: string; candidate: IceCandidatePayload }) =>
      this.cb.onIce?.(p.from, p.candidate),
    );
    this.sock.on(SIGNAL_EVENTS.error, (p: { message: string }) => this.cb.onError?.(p.message));
    this.sock.on('disconnect', (reason) => this.cb.onDisconnect?.(reason));
    this.sock.on('connect_error', (err) => this.cb.onError?.(err.message));
  }

  get connected(): boolean {
    return this.sock.connected;
  }

  sendSdp(sessionId: string, sdp: SdpPayload): void {
    this.sock.emit(SIGNAL_EVENTS.sdp, { sessionId, sdp });
  }

  sendIce(sessionId: string, candidate: IceCandidatePayload): void {
    this.sock.emit(SIGNAL_EVENTS.ice, { sessionId, candidate });
  }

  close(): void {
    this.sock.removeAllListeners();
    this.sock.close();
  }
}

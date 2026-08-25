import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  SIGNAL_EVENTS,
  type IceCandidatePayload,
  type PeerRole,
  type SdpPayload,
  type SignalJoinPayload,
} from '@helpdesk/shared';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService } from '../audit/audit.service';
import { SessionRoomsService } from './session-rooms.service';
import { corsOrigin } from '../cors';

interface AuthedSocket extends Socket {
  data: { sessionId?: string; role?: PeerRole };
}

function peerTag(role: PeerRole, socketId: string): string {
  return `${role}:${socketId}`;
}

/**
 * socket.io signalling relay: SDP + ICE only. Never touches media payloads.
 * Event names are locked — see docs/signalling-protocol.md.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: corsOrigin(), credentials: true } })
export class SignallingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('Signalling');

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionsService,
    private readonly rooms: SessionRoomsService,
    private readonly audit: AuditService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.debug(`socket connected ${client.id}`);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    const left = this.rooms.leave(client.id);
    if (!left) return;
    const { sessionId, role } = left;
    const tag = peerTag(role, client.id);
    this.server.to(`session:${sessionId}`).emit(SIGNAL_EVENTS.peerLeft, {
      sessionId,
      peer: tag,
    });
    await this.audit.record(sessionId, 'peer_left', { role });
    this.logger.log(`session ${sessionId}: ${role} disconnected`);
  }

  @SubscribeMessage(SIGNAL_EVENTS.join)
  async onJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: SignalJoinPayload,
  ): Promise<{ ok: true; peers: string[] } | { ok: false; error: string }> {
    // NOTE: WsException never reaches the client ack in this stack — always
    // return error objects instead of throwing.
    if (!payload || typeof payload.token !== 'string' || !payload.sessionId) {
      return { ok: false, error: 'invalid join payload' };
    }
    const verified = await this.sessions.verifySignallingToken(payload.token);
    if (!verified || verified.sessionId !== payload.sessionId) {
      return { ok: false, error: 'invalid or expired signalling token' };
    }
    if (verified.role !== payload.role) {
      return { ok: false, error: 'signalling token role mismatch' };
    }

    const result = this.rooms.join(payload.sessionId, payload.role, client.id);
    if (!result.ok) {
      return { ok: false, error: `a ${payload.role} peer is already connected to this session` };
    }

    client.data.sessionId = payload.sessionId;
    client.data.role = payload.role;
    const room = `session:${payload.sessionId}`;
    const peersAlready = result.peers.map((p) => peerTag(p.role, p.socketId));

    client.join(room);
    for (const peer of result.peers) {
      this.server.to(peer.socketId).emit(SIGNAL_EVENTS.peerJoined, {
        sessionId: payload.sessionId,
        peer: peerTag(payload.role, client.id),
      });
    }
    await this.sessions.markPeerConnected(payload.sessionId);
    this.logger.log(`session ${payload.sessionId}: ${payload.role} joined signalling`);
    return { ok: true, peers: peersAlready };
  }

  @SubscribeMessage(SIGNAL_EVENTS.sdp)
  onSdp(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { sessionId: string; sdp: SdpPayload },
  ): { ok: boolean; error?: string } {
    const guard = this.assertMember(client, payload?.sessionId);
    if (guard) return guard;
    if (!payload.sdp || (payload.sdp.type !== 'offer' && payload.sdp.type !== 'answer')) {
      return { ok: false, error: 'invalid sdp payload' };
    }
    const targets = this.rooms.otherPeers(payload.sessionId, client.id);
    for (const target of targets) {
      this.server.to(target).emit(SIGNAL_EVENTS.sdp, {
        from: peerTag(client.data.role!, client.id),
        sdp: payload.sdp,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage(SIGNAL_EVENTS.ice)
  onIce(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { sessionId: string; candidate: IceCandidatePayload },
  ): { ok: boolean; error?: string } {
    const guard = this.assertMember(client, payload?.sessionId);
    if (guard) return guard;
    const c = payload.candidate;
    if (!c || typeof c.candidate !== 'string') {
      return { ok: false, error: 'invalid ice payload' };
    }
    const targets = this.rooms.otherPeers(payload.sessionId, client.id);
    for (const target of targets) {
      this.server.to(target).emit(SIGNAL_EVENTS.ice, {
        from: peerTag(client.data.role!, client.id),
        candidate: c,
      });
    }
    return { ok: true };
  }

  /** Broadcasts peer-left for a session end and clears room state. */
  notifySessionEnded(sessionId: string): void {
    this.server.to(`session:${sessionId}`).emit(SIGNAL_EVENTS.peerLeft, {
      sessionId,
      peer: 'session:ended',
    });
    this.rooms.dropSession(sessionId);
  }

  private assertMember(
    client: AuthedSocket,
    sessionId: string | undefined,
  ): { ok: false; error: string } | null {
    if (!sessionId || client.data.sessionId !== sessionId) {
      return { ok: false, error: 'socket is not a member of this session' };
    }
    return null;
  }
}

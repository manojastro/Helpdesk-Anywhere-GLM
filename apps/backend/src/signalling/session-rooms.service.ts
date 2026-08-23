import { Injectable, Logger } from '@nestjs/common';
import type { PeerRole } from '@helpdesk/shared';

interface RoomPeer {
  socketId: string;
  role: PeerRole;
}

/**
 * In-memory occupancy map for POC: session id → connected peers.
 * Exactly one technician + one endpoint per session.
 */
@Injectable()
export class SessionRoomsService {
  private readonly logger = new Logger('SessionRooms');
  private readonly rooms = new Map<string, Map<PeerRole, RoomPeer>>();

  /**
   * Registers a peer. Rejects a second socket claiming an occupied role.
   * Returns the peers that were already present.
   */
  join(sessionId: string, role: PeerRole, socketId: string): { ok: true; peers: RoomPeer[] } | { ok: false; reason: string } {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Map();
      this.rooms.set(sessionId, room);
    }
    const existing = room.get(role);
    if (existing && existing.socketId !== socketId) {
      return { ok: false, reason: `a ${role} peer is already connected to this session` };
    }
    const peers = [...room.values()].filter((p) => p.socketId !== socketId);
    room.set(role, { socketId, role });
    this.logger.debug(`room ${sessionId}: ${role} joined (${room.size} peers)`);
    return { ok: true, peers };
  }

  /** Removes a socket from any session it occupies. Returns removal info. */
  leave(socketId: string): { sessionId: string; role: PeerRole } | null {
    for (const [sessionId, room] of this.rooms) {
      for (const [role, peer] of room) {
        if (peer.socketId === socketId) {
          room.delete(role);
          if (room.size === 0) this.rooms.delete(sessionId);
          this.logger.debug(`room ${sessionId}: ${role} left`);
          return { sessionId, role };
        }
      }
    }
    return null;
  }

  /** The socket ids of the *other* peers in the session (excluding sender). */
  otherPeers(sessionId: string, exceptSocketId: string): string[] {
    const room = this.rooms.get(sessionId);
    if (!room) return [];
    return [...room.values()].filter((p) => p.socketId !== exceptSocketId).map((p) => p.socketId);
  }

  peerId(sessionId: string, role: PeerRole): string | null {
    return this.rooms.get(sessionId)?.get(role)?.socketId ?? null;
  }

  dropSession(sessionId: string): void {
    this.rooms.delete(sessionId);
  }
}

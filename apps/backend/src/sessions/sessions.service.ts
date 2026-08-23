import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import type { PeerRole, SessionDto } from '@helpdesk/shared';
import { SupportSession } from './session.entity';
import { AuditService } from '../audit/audit.service';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easily-confused chars
const JOIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const SIGNALLING_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export interface SignallingTokenClaims {
  sid: string;
  role: PeerRole;
  typ: 'signalling';
  code: string;
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function toDto(s: SupportSession): SessionDto {
  return {
    id: s.id,
    code: s.code,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    connectedAt: s.connectedAt ? s.connectedAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger('Sessions');

  constructor(
    @InjectRepository(SupportSession)
    private readonly repo: Repository<SupportSession>,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async create(technicianId: string): Promise<{ session: SessionDto; joinToken: string }> {
    const code = this.generateCode();
    const joinToken = randomBytes(24).toString('base64url');
    const session = await this.repo.save(
      this.repo.create({
        code,
        technicianId,
        status: 'waiting',
        joinTokenHash: sha256(joinToken),
        joinTokenExpiresAt: new Date(Date.now() + JOIN_TOKEN_TTL_MS),
      }),
    );
    await this.audit.record(session.id, 'session_created', { code });
    this.logger.log(`session ${code} created by technician ${technicianId}`);
    return { session: toDto(session), joinToken };
  }

  async join(
    code: string,
    joinToken: string,
    role: PeerRole,
  ): Promise<{ session: SessionDto; signallingToken: string }> {
    if (role !== 'technician' && role !== 'endpoint') {
      throw new BadRequestException('role must be technician or endpoint');
    }
    const session = await this.repo.findOne({ where: { code: code.toUpperCase() } });
    if (!session) throw new NotFoundException('Unknown session code');
    if (session.status === 'ended') throw new BadRequestException('Session already ended');
    if (session.joinTokenHash !== sha256(joinToken)) {
      throw new ForbiddenException('Invalid join token');
    }
    if (session.joinTokenExpiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Join token expired');
    }

    if (role === 'endpoint' && session.status === 'waiting') {
      session.status = 'active';
      session.connectedAt = new Date();
      await this.repo.save(session);
    }
    await this.audit.record(session.id, `${role}_joined`);

    const claims: SignallingTokenClaims = {
      sid: session.id,
      role,
      typ: 'signalling',
      code: session.code,
    };
    const signallingToken = await this.jwt.signAsync(claims, {
      expiresIn: SIGNALLING_TOKEN_TTL_SECONDS,
    });
    return { session: toDto(session), signallingToken };
  }

  async end(code: string, technicianId: string): Promise<SessionDto> {
    const session = await this.repo.findOne({ where: { code: code.toUpperCase() } });
    if (!session) throw new NotFoundException('Unknown session code');
    if (session.technicianId !== technicianId) {
      throw new ForbiddenException('Not the session owner');
    }
    if (session.status !== 'ended') {
      session.status = 'ended';
      session.endedAt = new Date();
      await this.repo.save(session);
      await this.audit.record(session.id, 'session_ended');
    }
    return toDto(session);
  }

  async getById(id: string): Promise<SupportSession | null> {
    return this.repo.findOne({ where: { id } });
  }

  async getByCode(code: string): Promise<SupportSession> {
    const session = await this.repo.findOne({ where: { code: code.toUpperCase() } });
    if (!session) throw new NotFoundException('Unknown session code');
    return session;
  }

  async markPeerConnected(sessionId: string): Promise<void> {
    const s = await this.repo.findOne({ where: { id: sessionId } });
    if (!s) return;
    if (s.status === 'waiting') {
      s.status = 'active';
      s.connectedAt = new Date();
      await this.repo.save(s);
    }
    await this.audit.record(sessionId, 'peer_connected');
  }

  async verifySignallingToken(
    token: string,
  ): Promise<{ sessionId: string; role: PeerRole } | null> {
    try {
      const claims = await this.jwt.verifyAsync<SignallingTokenClaims>(token);
      if (claims.typ !== 'signalling') return null;
      const session = await this.repo.findOne({ where: { id: claims.sid } });
      if (!session || session.status === 'ended') return null;
      return { sessionId: session.id, role: claims.role };
    } catch {
      return null;
    }
  }

  async findEndedOrActive(): Promise<SupportSession[]> {
    return this.repo.find({ where: [{ status: 'active' }, { status: 'waiting' }] });
  }

  private generateCode(): string {
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    return code;
  }
}

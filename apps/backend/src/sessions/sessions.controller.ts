import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import type {
  CreateSessionResponse,
  JoinSessionResponse,
  SessionEventDto,
} from '@helpdesk/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentTechnician } from '../auth/current-technician.decorator';
import { SessionsService } from './sessions.service';
import { AuditService } from '../audit/audit.service';

class JoinDto {
  @IsString()
  @Length(20, 200)
  joinToken!: string;

  @IsIn(['technician', 'endpoint'])
  role!: 'technician' | 'endpoint';
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentTechnician() technicianId: string): Promise<CreateSessionResponse> {
    return this.sessions.create(technicianId);
  }

  @Post(':code/join')
  async join(@Param('code') code: string, @Body() dto: JoinDto): Promise<JoinSessionResponse> {
    return this.sessions.join(code, dto.joinToken, dto.role);
  }

  @Post(':code/end')
  @UseGuards(JwtAuthGuard)
  async end(
    @Param('code') code: string,
    @CurrentTechnician() technicianId: string,
  ) {
    return { session: await this.sessions.end(code, technicianId) };
  }

  @Get(':code')
  @UseGuards(JwtAuthGuard)
  async get(@Param('code') code: string): Promise<{
    session: { id: string; code: string; status: string; createdAt: string; connectedAt: string | null; endedAt: string | null };
    events: SessionEventDto[];
  }> {
    const session = await this.sessions.getByCode(code);
    const events = await this.audit.listForSession(session.id);
    return {
      session: {
        id: session.id,
        code: session.code,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        connectedAt: session.connectedAt ? session.connectedAt.toISOString() : null,
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      },
      events: events.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        eventType: e.eventType,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}

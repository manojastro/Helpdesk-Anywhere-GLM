import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEvent } from './session-event.entity';

/** Records basic session lifecycle/audit facts. No SDP/ICE, no media, no tokens. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    @InjectRepository(SessionEvent)
    private readonly repo: Repository<SessionEvent>,
  ) {}

  async record(
    sessionId: string,
    eventType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({ sessionId, eventType, metadata: metadata ?? null }),
      );
    } catch (err) {
      // Audit failure must not break session flow, but must be visible.
      this.logger.error(`failed to record event ${eventType} for ${sessionId}: ${String(err)}`);
    }
  }

  async listForSession(sessionId: string): Promise<SessionEvent[]> {
    return this.repo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }
}

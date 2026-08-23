import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AuditModule } from '../audit/audit.module';
import { SignallingGateway } from './signalling.gateway';
import { SessionRoomsService } from './session-rooms.service';

@Module({
  imports: [SessionsModule, AuditModule],
  providers: [SignallingGateway, SessionRoomsService],
  exports: [SignallingGateway],
})
export class SignallingModule {}

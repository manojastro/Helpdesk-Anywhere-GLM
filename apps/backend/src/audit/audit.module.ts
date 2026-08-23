import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEvent } from './session-event.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

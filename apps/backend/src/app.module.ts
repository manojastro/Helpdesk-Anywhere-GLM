import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { AuditModule } from './audit/audit.module';
import { SignallingModule } from './signalling/signalling.module';
import { IceConfigModule } from './ice/ice.module';
import { Technician } from './technicians/technician.entity';
import { SupportSession } from './sessions/session.entity';
import { SessionEvent } from './audit/session-event.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        // POC: SQLite by default; PostgreSQL when DATABASE_URL is set (Cloud SQL).
        const url = process.env.DATABASE_URL;
        if (url) {
          return {
            type: 'postgres' as const,
            url,
            synchronize: true,
            entities: [Technician, SupportSession, SessionEvent],
          };
        }
        return {
          type: 'better-sqlite3' as const,
          database: process.env.SQLITE_PATH ?? 'helpdesk.sqlite',
          synchronize: true,
          entities: [Technician, SupportSession, SessionEvent],
        };
      },
    }),
    AuthModule,
    SessionsModule,
    AuditModule,
    SignallingModule,
    IceConfigModule,
  ],
})
export class AppModule {}

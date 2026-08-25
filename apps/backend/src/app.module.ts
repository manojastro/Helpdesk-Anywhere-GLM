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
        //
        // synchronize auto-alters the schema to match the entities on every
        // boot, which can silently drop columns/data on a live database. It is
        // fine for the local SQLite POC, so it stays on by default in dev, but
        // it must never run unnoticed against Cloud SQL.
        //
        // Migration story: this POC has no TypeORM migrations yet. Until it
        // does, a production deployment has to create the schema somehow, so
        // the gate is an explicit opt-in rather than a hard off — set
        // DB_SYNCHRONIZE=true for the first boot against an empty database,
        // then remove it. The real fix is committed migrations
        // (`typeorm migration:generate`, run on release), after which
        // DB_SYNCHRONIZE should never be set in production again.
        const synchronize =
          process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV !== 'production';
        const url = process.env.DATABASE_URL;
        if (url) {
          return {
            type: 'postgres' as const,
            url,
            synchronize,
            entities: [Technician, SupportSession, SessionEvent],
          };
        }
        return {
          type: 'better-sqlite3' as const,
          database: process.env.SQLITE_PATH ?? 'helpdesk.sqlite',
          synchronize,
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

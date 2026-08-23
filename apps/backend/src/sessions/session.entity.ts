import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SessionStatus = 'waiting' | 'active' | 'ended';

@Entity('sessions')
export class SupportSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'session_code', length: 16 })
  code!: string;

  @Column({ name: 'technician_id' })
  technicianId!: string;

  @Column({ default: 'waiting' })
  status!: SessionStatus;

  /** sha256 hash of the join token — raw token is never persisted. */
  @Column({ name: 'join_token_hash', length: 128 })
  joinTokenHash!: string;

  @Column({ name: 'join_token_expires_at', type: 'datetime' })
  joinTokenExpiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'connected_at', type: 'datetime', nullable: true })
  connectedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt!: Date | null;
}

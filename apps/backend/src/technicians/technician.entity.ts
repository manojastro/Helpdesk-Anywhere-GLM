import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('technicians')
export class Technician {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  email!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column({ name: 'created_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}

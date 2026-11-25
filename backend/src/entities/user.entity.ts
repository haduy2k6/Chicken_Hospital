import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { DoctorProfile } from './doctor.entity.js';
import { PatientProfile } from './patient.entity.js';
import { UserRole } from './user-role.enum.js';

@Entity('users')
@Unique('UQ_users_provider_provider_id', ['provider', 'providerId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  provider: string;

  @Column({ type: 'varchar', length: 255, name: 'provider_id' })
  providerId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar?: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.PATIENT, name: 'active_role' })
  activeRole: UserRole;

  @OneToOne(() => DoctorProfile, (d) => d.user)
  doctor?: Relation<DoctorProfile>;

  @OneToOne(() => PatientProfile, (p) => p.user)
  patient?: Relation<PatientProfile>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
export { UserRole };


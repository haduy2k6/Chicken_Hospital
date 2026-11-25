import {
  Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { DoctorProfile } from './doctor.entity.js';
import { PatientProfile } from './patient.entity.js';
import { MedicalCase } from './medical-case.entity.js';

export enum AppointmentStatus {
  SCHEDULED = 'scheduled',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

export enum AppointmentCreator {
  DOCTOR = 'doctor', // bác sĩ hẹn tái khám khi kết luận
  PATIENT = 'patient', // bệnh nhân đặt theo lịch làm việc của bác sĩ
}

const ACTIVE = `"status" IN ('scheduled', 'confirmed')`;
const COUNTED = `"status" <> 'cancelled'`;

/** Một bảng cho cả bác sĩ hẹn và bệnh nhân đặt. Tên unique index được SchedulingService dùng để phân biệt lỗi. */
@Entity('appointments')
@Index('uq_appt_slot', ['doctorId', 'scheduledAt'], { unique: true, where: ACTIVE })
@Index('uq_appt_case_active', ['caseId'], { unique: true, where: ACTIVE })
@Index('idx_appt_doctor_date', ['doctorId', 'appointmentDate'], { where: COUNTED })
@Index('idx_appt_cron', ['scheduledAt'], { where: ACTIVE })
@Index('IDX_appointments_patient_scheduled', ['patientId', 'scheduledAt'])
@Index('IDX_appointments_case', ['caseId'])
@Check('CK_appointments_cancel_consistent', `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`)
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId: string;

  @ManyToOne(() => DoctorProfile, (d) => d.appointments, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'doctor_id' })
  doctor: Relation<DoctorProfile>;

  @Column({ type: 'uuid', name: 'patient_id' })
  patientId: string;

  @ManyToOne(() => PatientProfile, (p) => p.appointments, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'patient_id' })
  patient: Relation<PatientProfile>;

  /** NULL khi ca đã bị xóa (xác nhận chuyển tuyến / hạn mức) */
  @Column({ type: 'uuid', name: 'case_id', nullable: true })
  caseId: string | null;

  @ManyToOne(() => MedicalCase, (c) => c.appointments, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'case_id' })
  medicalCase?: Relation<MedicalCase> | null;

  /** Thời điểm hẹn (UTC) */
  @Column({ type: 'timestamptz', name: 'scheduled_at' })
  scheduledAt: Date;

  /** Ngày hẹn theo giờ Asia/Ho_Chi_Minh ('YYYY-MM-DD') */
  @Column({ type: 'date', name: 'appointment_date' })
  appointmentDate: string;

  @Column({ type: 'enum', enum: AppointmentStatus, default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;

  @Column({ type: 'enum', enum: AppointmentCreator, name: 'created_by' })
  createdBy: AppointmentCreator;

  @Column({ type: 'text', nullable: true })
  note?: string;

  /** Chỉ có giá trị khi status = cancelled */
  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}

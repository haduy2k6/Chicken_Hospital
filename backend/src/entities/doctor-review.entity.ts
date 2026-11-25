import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { MedicalCase } from './medical-case.entity.js';
import { DoctorProfile } from './doctor.entity.js';

export enum ReviewDecision {
  REVIEWED = 'reviewed',
  ESCALATED = 'escalated',
}

/**
 * Kết luận của bác sĩ, chỉ thêm mới. Một ca có thể có nhiều bản ghi (chuyển tuyến rồi bác sĩ nhận kết luận);
 * bản ghi mới nhất theo created_at là kết luận hiện hành.
 */
@Entity('doctor_reviews')
@Index('IDX_doctor_reviews_case_created', ['caseId', 'createdAt'])
export class DoctorReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // CASCADE: xóa ca (xác nhận chuyển tuyến / hạn mức) kéo theo kết luận
  @Column({ type: 'uuid', name: 'case_id' })
  caseId: string;

  @ManyToOne(() => MedicalCase, (c) => c.reviews, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'case_id' })
  medicalCase: Relation<MedicalCase>;

  @Column({ type: 'uuid', name: 'doctor_id' })
  doctorId: string;

  @ManyToOne(() => DoctorProfile, (d) => d.reviews, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'doctor_id' })
  doctor: Relation<DoctorProfile>;

  @Column({ type: 'enum', enum: ReviewDecision })
  decision: ReviewDecision;

  @Column({ type: 'text' })
  notes: string;

  /** Form đánh giá chuyên khoa do bác sĩ điền */
  @Column({ type: 'jsonb', name: 'assessment_data', default: () => "'{}'" })
  assessmentData: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}

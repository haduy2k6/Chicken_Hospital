import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AiAnalysis } from '../entities/ai-analysis.entity.js';
import { Appointment } from '../entities/appointment.entity.js';
import { AuditLog } from '../entities/audit-log.entity.js';
import { CaseImage } from '../entities/case-image.entity.js';
import { DoctorProfile } from '../entities/doctor.entity.js';
import { DoctorAvailability } from '../entities/doctor-availability.entity.js';
import { DoctorReview } from '../entities/doctor-review.entity.js';
import { MedicalCase } from '../entities/medical-case.entity.js';
import { PatientProfile } from '../entities/patient.entity.js';
import { Referral } from '../entities/referral.entity.js';
import { Specialty } from '../entities/specialty.entity.js';
import { User } from '../entities/user.entity.js';

const sslOption = () => {
  const ca = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
};

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    entities: [
      AiAnalysis, Appointment, AuditLog, CaseImage, DoctorAvailability, DoctorProfile,
      DoctorReview, MedicalCase, PatientProfile, Referral, Specialty, User,
    ],
    ssl: sslOption(),
    // Chỉ tự đồng bộ schema ở development; production dùng migration (hoặc DB_SYNC=true rõ ràng)
    synchronize: process.env.DB_SYNC ? process.env.DB_SYNC === 'true' : process.env.NODE_ENV === 'development',
    extra: {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  }),
);

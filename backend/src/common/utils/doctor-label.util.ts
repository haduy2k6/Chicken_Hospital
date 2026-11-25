import type { DoctorProfile } from '../../entities/doctor.entity.js';

/** Tên hiển thị của bác sĩ, dùng chung cho lịch hẹn, hồ sơ và danh bạ. */
export const doctorLabel = (doctor: DoctorProfile): string =>
  `${doctor.degree ? `${doctor.degree} ` : ''}${doctor.user?.name ?? 'Bác sĩ'}`.trim();

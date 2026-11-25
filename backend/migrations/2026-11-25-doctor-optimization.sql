-- Tối ưu doctor: partial index cho hàng đợi, chuyển tuyến và lịch hẹn.
-- Chạy NGOÀI transaction (CONCURRENTLY). production không dùng synchronize nên phải apply file này.

-- ------------------------------------------------------------------ tên cũ
DROP INDEX CONCURRENTLY IF EXISTS "UQ_appointments_doctor_active_slot";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_appointments_doctor_day_active";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_referrals_case";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_referrals_to_doctor";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_referrals_to_specialty";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_ai_analyses_case";
DROP INDEX CONCURRENTLY IF EXISTS "IDX_doctor_reviews_doctor_created";

-- ------------------------------------------------------------------ hàng đợi bác sĩ
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_queue
  ON medical_cases (specialty_id, ai_risk_score DESC NULLS LAST, created_at DESC) WHERE status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_escalated
  ON medical_cases (created_at DESC) WHERE status = 'escalated';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_reviewed
  ON medical_cases (assigned_doctor_id, ai_risk_score DESC NULLS LAST, created_at DESC) WHERE status = 'reviewed';

-- Ca chuyển tuyến: tra theo bác sĩ / khoa nhận
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_case ON referrals (case_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_to_doctor
  ON referrals (to_doctor_id) WHERE to_doctor_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referral_to_specialty
  ON referrals (to_specialty_id) WHERE to_specialty_id IS NOT NULL;

-- Phân tích AI theo ca
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_case ON ai_analyses (case_id);

-- ------------------------------------------------------------------ lịch hẹn
-- Hai unique index này được SchedulingService.reserve dùng để phân biệt SLOT_TAKEN / ALREADY_BOOKED.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_appt_slot
  ON appointments (doctor_id, scheduled_at) WHERE status IN ('scheduled', 'confirmed');
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_appt_case_active
  ON appointments (case_id) WHERE status IN ('scheduled', 'confirmed');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appt_doctor_date
  ON appointments (doctor_id, appointment_date) WHERE status <> 'cancelled';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appt_cron
  ON appointments (scheduled_at) WHERE status IN ('scheduled', 'confirmed');

-- Lịch làm việc: tra theo ngày để lọc bác sĩ còn trống
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_avail_date ON doctor_availability (work_date, doctor_id);

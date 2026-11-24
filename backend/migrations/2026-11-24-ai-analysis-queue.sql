-- Migration: Thêm trạng thái và trường quản lý hàng đợi cho ai_analyses
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_analyses_status_enum') THEN
    ALTER TYPE "ai_analyses_status_enum" ADD VALUE IF NOT EXISTS 'pending';
    ALTER TYPE "ai_analyses_status_enum" ADD VALUE IF NOT EXISTS 'dispatched';
  END IF;
END$$;

ALTER TABLE "ai_analyses" 
  ADD COLUMN IF NOT EXISTS "dispatched_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "retry_count" INT NOT NULL DEFAULT 0;

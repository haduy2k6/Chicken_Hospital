-- Migration: Chuyển status sang VARCHAR(30) và thêm các trường quản lý hàng đợi
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_analyses' AND column_name = 'status' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE "ai_analyses" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "ai_analyses" ALTER COLUMN "status" TYPE VARCHAR(30) USING "status"::text;
    ALTER TABLE "ai_analyses" ALTER COLUMN "status" SET DEFAULT 'pending';
  END IF;
END$$;

ALTER TABLE "ai_analyses" 
  ADD COLUMN IF NOT EXISTS "dispatched_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "retry_count" INT NOT NULL DEFAULT 0;

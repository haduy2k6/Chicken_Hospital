import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { allowedOrigins, isAllowedOrigin } from './common/safe-redirect.util.js';

async function bootstrap() {
  allowedOrigins(); 

  const app = await NestFactory.create(AppModule);

  try {
    const ds = app.get(DataSource);
    await ds.query(`
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
    `);
    await ds.query(`
      ALTER TABLE "ai_analyses" 
        ADD COLUMN IF NOT EXISTS "dispatched_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "retry_count" INT NOT NULL DEFAULT 0;
    `);
  } catch (err) {
    console.warn('Auto-migration warning:', (err as Error).message);
  }

  const httpInstance = app.getHttpAdapter().getInstance();
  httpInstance.set('trust proxy', 1);
  httpInstance.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, isAllowedOrigin(origin)),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4002);
}
await bootstrap();

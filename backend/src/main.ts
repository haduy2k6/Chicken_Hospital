import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { frontOrigin, isFrontOrigin } from './common/utils/safe-redirect.util.js';

async function bootstrap() {
  // Fail-fast nếu FRONT thiếu/sai ngay từ lúc khởi động (chỉ áp dụng ở production).
  frontOrigin();

  const app = await NestFactory.create(AppModule);
  const httpInstance = app.getHttpAdapter().getInstance();
  httpInstance.set('trust proxy', 1);
  httpInstance.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, isFrontOrigin(origin)),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4002);
}
await bootstrap();

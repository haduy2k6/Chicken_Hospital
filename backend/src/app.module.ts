import {
  MiddlewareConsumer, Module, NestModule, RequestMethod, ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { CaseSupportModule } from './case-support/case-support.module.js';
import { validateEnv } from './config/env.validation.js';
import databaseConfig from './config/database.config.js';
import { DoctorModule } from './doctor/doctor.module.js';
import { PatientModule } from './patient/patient.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';
import { trustedOrigin } from './common/middleware/trusted-origin.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig], validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    RedisModule,
    CaseSupportModule,
    SchedulingModule,
    AuthModule,
    PatientModule,
    DoctorModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(trustedOrigin).forRoutes(
      { path: 'auth/refresh', method: RequestMethod.POST },
      { path: 'auth/logout', method: RequestMethod.POST },
      { path: 'auth/logout-all', method: RequestMethod.POST },
    );
  }
}

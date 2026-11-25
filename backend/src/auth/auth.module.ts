import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import jwtConfig from '../config/jwt.config.js';
import googleConfig from '../config/google.config.js';
import refreshJwt from '../config/refresh-jwt.config.js';
import { User } from '../entities/user.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { oauthLocale } from '../common/middleware/oauth-locale.middleware.js';
import { AccessTokenStrategy } from './strategies/access.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { RefreshTokenStrategy } from './strategies/refresh.strategy.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(jwtConfig),
    ConfigModule.forFeature(refreshJwt),
    ConfigModule.forFeature(googleConfig),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenStrategy, GoogleStrategy, RefreshTokenStrategy],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(oauthLocale)
      .forRoutes(
        { path: 'auth/google', method: RequestMethod.GET },
        { path: 'auth/google/callback', method: RequestMethod.GET },
      );
  }
}

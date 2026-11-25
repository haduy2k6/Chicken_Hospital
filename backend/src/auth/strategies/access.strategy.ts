import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RedisUser } from '../../redis/redis.service.js';
import jwtConfig from '../../config/jwt.config.js';
import { AuthService } from '../auth.service.js';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(jwtConfig.KEY) config: ConfigType<typeof jwtConfig>,
    private readonly authService: AuthService,
    private readonly redisCache: RedisUser,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.secret!,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; sid?: string }) {
    // Token cũ không có sid vẫn hợp lệ; token có sid phải thuộc phiên chưa bị logout.
    if (payload.sid && !(await this.redisCache.isSessionActive(payload.sub, payload.sid))) {
      throw new UnauthorizedException('Phiên đăng nhập đã kết thúc');
    }

    const profile = await this.authService.getProfile(payload.sub);
    return { userId: payload.sub, role: profile.role, sid: payload.sid };
  }
}

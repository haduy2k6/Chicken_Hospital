import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { REFRESH_COOKIE } from '../../common/utils/auth-cookie.util.js';
import refreshJwt from '../../config/refresh-jwt.config.js';

const extractRefreshToken = (request: Request): string | null => request?.cookies?.[REFRESH_COOKIE] ?? null;

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(@Inject(refreshJwt.KEY) config: ConfigType<typeof refreshJwt>) {
    super({
      jwtFromRequest: extractRefreshToken,
      secretOrKey: config.secret!,
      algorithms: ['HS256'],
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: { sub: string; sid?: string; sat?: number }) {
    const refreshToken = extractRefreshToken(request);
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');
    if (!payload.sid) throw new UnauthorizedException('Phiên đăng nhập cũ, vui lòng đăng nhập lại');

    return {
      userId: payload.sub,
      sid: payload.sid,
      refreshToken,
      // Phải chuyển tiếp `sat` để AuthService không coi mỗi lần refresh là bắt đầu phiên mới.
      sat: payload.sat,
    };
  }
}

import { Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { GoogleCallbackFilter } from '../common/filters/google-callback.filter.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../common/utils/auth-cookie.util.js';
import { bearerTokenFrom } from '../common/utils/request.util.js';
import { frontUrl } from '../common/utils/safe-redirect.util.js';
import { AuthService } from './auth.service.js';
import type { OAuthRequest } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { toSiteRole } from './dto/auth.dto.js';
import type { AuthUserDto } from './dto/auth.dto.js';
import { AccessGuard } from './guards/access-token.guard.js';
import { GoogleGuard } from './guards/google.guard.js';
import { RefreshGuard } from './guards/refresh-token.guard.js';

type GoogleCallbackRequest = OAuthRequest & { user: AuthUserDto };
type RefreshUser = { userId: string; sid: string; refreshToken: string; sat?: number };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(GoogleGuard)
  loginByGoogle() {}

  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(GoogleGuard)
  @UseFilters(GoogleCallbackFilter)
  async googleCallback(@Req() req: GoogleCallbackRequest, @Res() res: Response) {
    const siteRole = toSiteRole(req.user.role);
    const refreshToken = await this.authService.startSession(req.user.userId);
    setAuthCookies(res, refreshToken, siteRole);
    return res.redirect(`${frontUrl(req.oauthLocale, siteRole)}?auth=success`);
  }

  @UseGuards(RefreshGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@CurrentUser() user: RefreshUser, @Res({ passthrough: true }) res: Response) {
    const { userId, sid, refreshToken, sat } = user;

    try {
      const result = await this.authService.refreshTokens(userId, sid, refreshToken, sat);
      const siteRole = toSiteRole(result.role);
      if (result.refreshToken) setAuthCookies(res, result.refreshToken, siteRole);

      return { accessToken: result.accessToken, userId, role: siteRole, name: result.name, email: result.email, avatar: result.avatar };
    } catch (error) {
      if (error instanceof UnauthorizedException) clearAuthCookies(res);
      throw error;
    }
  }

  @UseGuards(AccessGuard)
  @Get('me')
  async getMe(@CurrentUser('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
    const payload = await this.authService.resolveLogoutPayload(req.cookies?.[REFRESH_COOKIE], bearerTokenFrom(req));
    if (payload?.sub && payload.sid) {
      await this.authService.logoutSession(payload.sub, payload.sid).catch(() => undefined);
    }
    return { success: true, message: 'Đăng xuất thành công' };
  }

  @UseGuards(AccessGuard)
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser('userId') userId: string, @Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
    await this.authService.logoutAll(userId);
    return { success: true, message: 'Đã đăng xuất khỏi mọi thiết bị' };
  }
}

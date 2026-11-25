import { randomBytes } from 'node:crypto';
import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import {
  STATE_COOKIE,
  clearOptions,
  packState,
  stateCookieOptions,
  unpackState,
} from '../../common/utils/auth-cookie.util.js';
import { safeEqual } from '../../common/utils/crypto.util.js';
import { isGoogleCallbackPath } from '../auth-routes.js';
import type { OAuthRequest } from '../auth.types.js';

@Injectable()
export class GoogleGuard extends AuthGuard('google') {
  override canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<OAuthRequest>();

    // Kiểm tra state TRƯỚC khi để Passport đổi code với Google và gọi validate()
    if (isGoogleCallbackPath(request.path)) {
      this.checkState(request, http.getResponse<Response>());
    }
    return super.canActivate(context);
  }

  override getAuthenticateOptions(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<OAuthRequest>();
    if (isGoogleCallbackPath(request.path)) return {};

    // Đường đi: nonce vừa gửi cho Google (state), vừa lưu vào cookie cùng locale để đường về lấy lại
    const nonce = randomBytes(24).toString('base64url');
    http.getResponse<Response>().cookie(STATE_COOKIE, packState(nonce, request.oauthLocale), stateCookieOptions());
    return { state: nonce, prompt: 'select_account' };
  }

  // Đường về: state Google trả lại phải khớp nonce trong cookie. Cookie bị xóa ngay nên chỉ dùng được một lần.
  private checkState(request: OAuthRequest, response: Response): void {
    const { nonce } = unpackState(request.cookies?.[STATE_COOKIE]);
    response.clearCookie(STATE_COOKIE, clearOptions(stateCookieOptions()));

    const state = request.query?.state;
    if (typeof state !== 'string' || !nonce || !safeEqual(state, nonce)) {
      throw new ForbiddenException({
        code: 'invalid_state',
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn, vui lòng thử lại',
      });
    }
  }
}

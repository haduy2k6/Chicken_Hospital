import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATE_COOKIE, clearAuthCookies, clearOptions, stateCookieOptions } from '../utils/auth-cookie.util.js';
import { DEFAULT_LOCALE, frontUrl } from '../utils/safe-redirect.util.js';
import type { Locale } from '../utils/safe-redirect.util.js';

@Catch()
export class GoogleCallbackFilter implements ExceptionFilter {
  private readonly logger = new Logger(GoogleCallbackFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { oauthLocale?: Locale }>();
    const res = http.getResponse<Response>();

    this.log(exception);
    if (res.headersSent) return;

    clearAuthCookies(res);
    res.clearCookie(STATE_COOKIE, clearOptions(stateCookieOptions()));

    // Về đúng ngôn ngữ user đang dùng; mã ngắn cho frontend phân biệt lỗi, không đưa message gốc lên URL
    const locale = req.oauthLocale ?? DEFAULT_LOCALE;
    res.redirect(`${frontUrl(locale)}?auth=error&reason=${encodeURIComponent(this.reasonOf(exception))}`);
  }

  private reasonOf(exception: unknown): string {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) return String(body.code); // vd 'invalid_state'
      return 'unauthorized'; // user bấm Hủy, hoặc validate trả null
    }
    return 'server_error'; // TokenError, InternalOAuthError, lỗi DB...
  }

  private log(exception: unknown) {
    if (exception instanceof HttpException) {
      this.logger.warn(`${exception.getStatus()} ${exception.message}`);
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error(String(exception));
    }
  }
}

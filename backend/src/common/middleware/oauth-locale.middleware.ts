import type { NextFunction, Request, Response } from 'express';
import type { OAuthRequest } from '../../auth/auth.types.js';
import { isGoogleCallbackPath } from '../../auth/auth-routes.js';
import { STATE_COOKIE, unpackState } from '../utils/auth-cookie.util.js';
import { toLocale } from '../utils/safe-redirect.util.js';

// Chỉ dùng khi frontend để trình duyệt gửi cả đường dẫn trong Referer (mặc định cross-origin chỉ gửi origin)
const localeFromReferer = (referer?: string): string | undefined => {
  try {
    return referer ? new URL(referer).pathname.split('/')[1] : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Gắn `req.oauthLocale` trước khi vào guard, để guard/controller/filter chỉ cần đọc.
 * - Đường đi (/auth/google): lấy từ ?locale=, dự phòng từ Referer.
 * - Đường về (/auth/google/callback): lấy lại từ cookie state đã lưu lúc đi.
 * Giá trị luôn đi qua whitelist nên không thể mang chuỗi lạ.
 */
export function oauthLocale(request: Request, _response: Response, next: NextFunction): void {
  const req = request as OAuthRequest;
  const path = req.originalUrl.split('?')[0]; // middleware gắn theo route có thể bị cắt req.path, originalUrl thì không

  req.oauthLocale = isGoogleCallbackPath(path)
    ? unpackState(req.cookies?.[STATE_COOKIE]).locale
    : toLocale(req.query?.locale ?? localeFromReferer(req.headers.referer));
  next();
}

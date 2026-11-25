import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { frontOrigin } from '../utils/safe-redirect.util.js';

/** Chỉ nhận request từ đúng một frontend (production: FRONT, development: localhost). Thiếu hoặc khác Origin thì từ chối. */
export function trustedOrigin(request: Request, _response: Response, next: NextFunction): void {
  if (request.headers.origin !== frontOrigin()) {
    throw new ForbiddenException('Origin không được phép');
  }
  next();
}

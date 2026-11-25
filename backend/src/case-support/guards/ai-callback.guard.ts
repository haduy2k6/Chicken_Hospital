import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { safeEqual } from '../../common/utils/crypto.util.js';

/** Chỉ AI service được phép gọi callback nội bộ. */
@Injectable()
export class AiCallbackGuard implements CanActivate {
  private readonly secret: string | undefined;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('AI_CALLBACK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-ai-key'];
    if (!this.secret || !safeEqual(provided, this.secret)) throw new UnauthorizedException();
    return true;
  }
}

import type { Request } from 'express';
import type { Locale } from '../common/utils/safe-redirect.util.js';
import type { AuthUserDto } from './dto/auth.dto.js';

export interface ProviderIdentity {
  provider: string;
  providerId: string;
  name?: string;
  email?: string;
  avatar?: string;
}

export interface AuthenticatedUser extends AuthUserDto {
  sid?: string;
}

/** Request qua các route Google: `oauthLocale` do oauthLocale middleware gắn sẵn. */
export type OAuthRequest = Request & { oauthLocale: Locale };

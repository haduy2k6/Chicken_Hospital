import type { CookieOptions, Response } from 'express';
import type { SiteRole } from '../../auth/dto/auth.dto.js';
import { toLocale } from './safe-redirect.util.js';
import type { Locale } from './safe-redirect.util.js';

export const REFRESH_COOKIE = 'refreshToken';
export const ROLE_COOKIE = 'role';
export const STATE_COOKIE = 'oauth_state';

export const REFRESH_TTL_SECONDS = 8 * 24 * 3600;
export const REFRESH_TTL_MS = REFRESH_TTL_SECONDS * 1000;
export const STATE_TTL_MS = 10 * 60 * 1000;

const isProd = () => process.env.NODE_ENV === 'production';

/** Frontend và API cùng một site nhờ rewrite /api của Next.js: không cần sameSite=none. */
const sameSiteOptions = (): CookieOptions => ({
  path: '/',
  secure: isProd(),
  sameSite: 'lax',
});

export const refreshCookieOptions = (): CookieOptions => ({ ...sameSiteOptions(), httpOnly: true, maxAge: REFRESH_TTL_MS });
export const roleCookieOptions = (): CookieOptions => ({ ...sameSiteOptions(), httpOnly: false, maxAge: REFRESH_TTL_MS });

export const stateCookieOptions = (): CookieOptions => ({
  path: '/',
  secure: isProd(),
  sameSite: 'lax',
  httpOnly: true,
  maxAge: STATE_TTL_MS,
});

export const clearOptions = (options: CookieOptions): CookieOptions => {
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest;
};

export const packState = (nonce: string, locale: Locale): string => `${nonce}.${locale}`;

export function unpackState(raw: unknown): { nonce?: string; locale: Locale } {
  const [nonce, locale] = typeof raw === 'string' ? raw.split('.') : [];
  return { nonce: nonce || undefined, locale: toLocale(locale) };
}

export function setAuthCookies(response: Response, refreshToken: string, siteRole: SiteRole): void {
  response.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  response.cookie(ROLE_COOKIE, siteRole, roleCookieOptions());
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(REFRESH_COOKIE, clearOptions(refreshCookieOptions()));
  response.clearCookie(ROLE_COOKIE, clearOptions(roleCookieOptions()));
}

import type { Request } from 'express';

/** Đọc bearer token; trả về null khi header không có hoặc sai dạng. */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.get('Authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token || null;
}

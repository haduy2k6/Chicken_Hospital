// src/common/safe-redirect.util.ts
let cached: string[] | undefined;

export function allowedOrigins(): string[] {
  if (cached) return cached;

  const list = (process.env.FRONT_ORIGINS ?? process.env.FRONT ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (list.length === 0) {
    if (process.env.NODE_ENV === 'production') throw new Error('Thiếu biến môi trường FRONT_ORIGINS');
    list.push('http://localhost:3002');
  }
  return (cached = list);
}

export function isAllowedOrigin(origin: unknown): boolean {
  if (!origin) return true;
  return typeof origin === 'string' && allowedOrigins().includes(origin);
}

export function resolveReturnOrigin(candidate?: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate) return null;
  try {
    const origin = new URL(candidate).origin;
    return allowedOrigins().includes(origin) ? origin : null;
  } catch {
    return null;
  }
}

export const defaultFrontOrigin = (): string => allowedOrigins()[0];

export const normalizeLocale = (value: unknown): 'vi' | 'en' => (value === 'en' ? 'en' : 'vi');

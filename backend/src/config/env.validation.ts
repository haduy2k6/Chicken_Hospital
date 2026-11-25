const ALWAYS = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL',
  'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
];
/** FRONT = origin duy nhất được tin cậy; production: https://chicken-hospital-gamma.vercel.app */
const PRODUCTION_ONLY = ['FRONT', 'AI_SERVICE_URL', 'AI_SERVICE_KEY', 'AI_CALLBACK_SECRET'];
const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
const DEV_CALLBACK_PATHS = ['/auth/google/callback', GOOGLE_CALLBACK_PATH];
const MIN_SECRET_LENGTH = 32;

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** Origin không được có path/query/hash; nếu không sẽ lệch giữa CORS và redirect. */
function isOrigin(value: unknown): boolean {
  const url = parseHttpUrl(value);
  return !!url && url.pathname === '/' && !url.search && !url.hash;
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const production = config.NODE_ENV === 'production';
  const required = production ? [...ALWAYS, ...PRODUCTION_ONLY] : ALWAYS;

  const missing = required.filter((key) => typeof config[key] !== 'string' || !(config[key] as string).trim());
  const errors = missing.length ? [`Thiếu biến môi trường: ${missing.join(', ')}`] : [];

  if (!missing.length) {
    const callback = parseHttpUrl(config.GOOGLE_CALLBACK_URL);
    const path = callback?.pathname.replace(/\/$/, '');
    const allowed = production ? [GOOGLE_CALLBACK_PATH] : DEV_CALLBACK_PATHS;
    if (!callback || callback.search || callback.hash || !path || !allowed.includes(path)) {
      errors.push(production
        ? `GOOGLE_CALLBACK_URL phải trỏ tới ${GOOGLE_CALLBACK_PATH} qua proxy Next.js`
        : `GOOGLE_CALLBACK_URL phải là ${DEV_CALLBACK_PATHS.join(' hoặc ')}`);
    }
  }

  if (production && !missing.length) {
    for (const key of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'AI_SERVICE_KEY', 'AI_CALLBACK_SECRET']) {
      if ((config[key] as string).length < MIN_SECRET_LENGTH) errors.push(`${key} phải dài ít nhất ${MIN_SECRET_LENGTH} ký tự`);
    }
    if (config.ACCESS_TOKEN_SECRET === config.REFRESH_TOKEN_SECRET) {
      errors.push('ACCESS_TOKEN_SECRET và REFRESH_TOKEN_SECRET phải khác nhau');
    }
    if (config.AI_SERVICE_KEY === config.AI_CALLBACK_SECRET) {
      errors.push('AI_SERVICE_KEY và AI_CALLBACK_SECRET phải khác nhau (hai chiều dùng hai bí mật riêng)');
    }
    if (!parseHttpUrl(config.AI_SERVICE_URL)) errors.push('AI_SERVICE_URL phải là URL HTTP(S) hợp lệ');
    if (!isOrigin(config.FRONT)) errors.push(`FRONT phải là origin hợp lệ (vd https://chicken-hospital-gamma.vercel.app)`);
  }

  if (errors.length) throw new Error(`Cấu hình môi trường không hợp lệ:\n- ${errors.join('\n- ')}`);
  return config;
}

// src/config/env.validation.ts
// Dừng ngay khi khởi động nếu thiếu biến bắt buộc (thay vì lỗi lúc đang chạy).
const ALWAYS = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL',
  'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
];
const PRODUCTION_ONLY = ['FRONT_ORIGINS', 'AI_SERVICE_URL', 'AI_SERVICE_KEY', 'AI_CALLBACK_SECRET'];
const MIN_SECRET_LENGTH = 32;

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const production = config.NODE_ENV === 'production';
  const required = production ? [...ALWAYS, ...PRODUCTION_ONLY] : ALWAYS;

  const missing = required.filter((k) => typeof config[k] !== 'string' || !(config[k] as string).trim());
  const errors = missing.length ? [`Thiếu biến môi trường: ${missing.join(', ')}`] : [];

  if (production && !missing.length) {
    for (const k of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'AI_SERVICE_KEY', 'AI_CALLBACK_SECRET']) {
      if ((config[k] as string).length < MIN_SECRET_LENGTH) errors.push(`${k} phải dài ít nhất ${MIN_SECRET_LENGTH} ký tự`);
    }
    if (config.ACCESS_TOKEN_SECRET === config.REFRESH_TOKEN_SECRET) {
      errors.push('ACCESS_TOKEN_SECRET và REFRESH_TOKEN_SECRET phải khác nhau');
    }
    if (config.AI_SERVICE_KEY === config.AI_CALLBACK_SECRET) {
      errors.push('AI_SERVICE_KEY và AI_CALLBACK_SECRET phải khác nhau (hai chiều dùng hai bí mật riêng)');
    }
    if (!isHttpUrl(config.AI_SERVICE_URL)) errors.push('AI_SERVICE_URL phải là URL HTTP(S) hợp lệ');
    for (const origin of String(config.FRONT_ORIGINS).split(',').map((value) => value.trim()).filter(Boolean)) {
      if (!isHttpUrl(origin)) errors.push(`FRONT_ORIGINS chứa URL không hợp lệ: ${origin}`);
    }
  }

  if (errors.length) throw new Error(`Cấu hình môi trường không hợp lệ:\n- ${errors.join('\n- ')}`);
  return config;
}

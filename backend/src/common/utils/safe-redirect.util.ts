// Đích redirect và Origin tin cậy: đúng một frontend. Không lấy URL từ request.
// Phải là hàm (không phải hằng số) để đọc env sau khi ConfigModule/dotenv nạp xong.

export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'vi';

export const toLocale = (value: unknown): Locale => (LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE);

const DEV_FRONT_ORIGIN = 'http://localhost:3002';

/** Production: bắt buộc là process.env.FRONT. Development: luôn là localhost. */
export function frontOrigin(): string {
  if (process.env.NODE_ENV !== 'production') return DEV_FRONT_ORIGIN;
  const front = process.env.FRONT;
  if (!front) throw new Error('Thiếu biến môi trường FRONT');
  return new URL(front).origin;
}

/** CORS cho phép request không có Origin (curl/server-side); browser thì phải khớp chính xác FRONT. */
export const isFrontOrigin = (origin: unknown): boolean => !origin || origin === frontOrigin();

/** `${FRONT}/${locale}` hoặc `${FRONT}/${locale}/${role}`. Chỉ nhận locale đã whitelist và role do server quyết định. */
export const frontUrl = (locale: Locale, role?: string): string => `${frontOrigin()}/${locale}${role ? `/${role}` : ''}`;

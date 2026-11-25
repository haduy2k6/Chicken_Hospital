import { timingSafeEqual } from 'node:crypto';

/** So sánh chuỗi không rò rỉ thời gian (nonce OAuth, AI callback secret...). */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

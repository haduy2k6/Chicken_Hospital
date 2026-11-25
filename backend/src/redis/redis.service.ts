// redis/redis.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { UPSTASH_REDIS } from './redis.provider.js';

export type RefreshCheck = 'current' | 'previous' | 'invalid';

const GRACE_SECONDS = 30;
const LOCK_SECONDS = 10;
/** Cache cục bộ kết quả "phiên còn hiệu lực" để mỗi request không phải gọi Redis qua HTTP */
const ACTIVE_CACHE_MS = 5_000;
const ACTIVE_CACHE_MAX = 10_000;

/** Xoay refresh token nguyên tử: current cũ -> prev (grace), current mới, đăng ký sid. 1 round trip. */
const ROTATE_LUA = `
local old = redis.call('GET', KEYS[1])
if old then redis.call('SET', KEYS[2], old, 'EX', ARGV[2]) end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SADD', KEYS[3], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 1`;

/** Chỉ xóa lock nếu vẫn là của mình */
const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

@Injectable()
export class RedisUser {
  private readonly log = new Logger(RedisUser.name);
  private readonly activeUntil = new Map<string, number>();
  private readonly lockTokens = new Map<string, string>();

  constructor(@Inject(UPSTASH_REDIS) private readonly cacheUser: Redis) {}

  private hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

  private equalHex(a: unknown, b: string): boolean {
    if (typeof a !== 'string') return false;
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private currentKey = (u: string, s: string) => `refresh:${u}:${s}`;
  private prevKey = (u: string, s: string) => `refresh:prev:${u}:${s}`;
  private lockKey = (u: string, s: string) => `refresh:lock:${u}:${s}`;
  private setKey = (u: string) => `sessions:${u}`;
  private profileKey = (u: string) => `user:profile:${u}`;

  // ------------------------------------------------------------ cache chung

  /** Cache-aside. Redis lỗi thì đọc thẳng nguồn; loader ném lỗi thì không cache. */
  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.cacheUser.get<T>(key);
      if (hit != null) return hit;
    } catch (err) {
      this.log.warn(`Redis get ${key} lỗi: ${(err as Error).message}`);
    }
    const value = await load();
    void this.cacheUser.set(key, value, { ex: ttlSeconds }).catch((err) => this.log.warn(`Redis set ${key} lỗi: ${(err as Error).message}`));
    return value;
  }

  /** Xóa cache khi dữ liệu nguồn thay đổi */
  async invalidate(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.cacheUser.del(...keys);
    } catch (err) {
      this.log.error(`Redis invalidate lỗi: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------ refresh token / phiên

  async saveRefresh(refreshToken: string, userId: string, sid: string, ttlSeconds: number): Promise<void> {
    await this.cacheUser.eval(
      ROTATE_LUA,
      [this.currentKey(userId, sid), this.prevKey(userId, sid), this.setKey(userId)],
      [this.hashToken(refreshToken), GRACE_SECONDS, ttlSeconds, sid],
    );
  }

  async checkRefresh(refreshToken: string, userId: string, sid: string): Promise<RefreshCheck> {
    const hash = this.hashToken(refreshToken);
    const [cur, prev] = await this.cacheUser.mget<string[]>(this.currentKey(userId, sid), this.prevKey(userId, sid));
    if (this.equalHex(cur, hash)) return 'current';
    if (this.equalHex(prev, hash)) return 'previous';
    return 'invalid';
  }

  /** Access token chỉ hợp lệ khi phiên (refresh token) còn tồn tại. Redis lỗi thì fail-open để tránh downtime. */
  async isSessionActive(userId: string, sid?: string): Promise<boolean> {
    if (!sid) return true;
    const key = this.currentKey(userId, sid);
    if ((this.activeUntil.get(key) ?? 0) > Date.now()) return true;
    try {
      const ok = (await this.cacheUser.exists(key)) === 1;
      if (ok) {
        if (this.activeUntil.size >= ACTIVE_CACHE_MAX) this.activeUntil.clear();
        this.activeUntil.set(key, Date.now() + ACTIVE_CACHE_MS);
      } else {
        this.activeUntil.delete(key);
      }
      return ok;
    } catch (err) {
      this.log.warn(`Redis không kiểm tra được phiên (fail-open): ${(err as Error).message}`);
      return true;
    }
  }

  async acquireRefreshLock(userId: string, sid: string): Promise<boolean> {
    const key = this.lockKey(userId, sid);
    const token = randomUUID();
    const res = await this.cacheUser.set(key, token, { nx: true, ex: LOCK_SECONDS });
    if (res !== 'OK') return false;
    this.lockTokens.set(key, token);
    return true;
  }

  async releaseRefreshLock(userId: string, sid: string): Promise<void> {
    const key = this.lockKey(userId, sid);
    const token = this.lockTokens.get(key);
    if (!token) return; // lock không phải của instance này (hoặc đã hết hạn): để nó tự hết hạn
    this.lockTokens.delete(key);
    try {
      await this.cacheUser.eval(UNLOCK_LUA, [key], [token]);
    } catch (err) {
      this.log.warn(`Không nhả được lock ${key}: ${(err as Error).message}`);
    }
  }

  /** Thu hồi phải thành công mới được coi là đã đăng xuất, nên lỗi Redis được ném ra thay vì nuốt */
  async revokeSession(userId: string, sid: string): Promise<void> {
    this.activeUntil.delete(this.currentKey(userId, sid));
    await this.cacheUser
      .pipeline()
      .del(this.currentKey(userId, sid))
      .del(this.prevKey(userId, sid))
      .srem(this.setKey(userId), sid)
      .exec();
  }

  async revokeAllSessions(userId: string): Promise<void> {
    const sids = (await this.cacheUser.smembers(this.setKey(userId))) as string[];
    const keys = [
      ...sids.flatMap((s) => [this.currentKey(userId, s), this.prevKey(userId, s)]),
      this.setKey(userId),
      this.profileKey(userId),
    ];
    for (const s of sids) this.activeUntil.delete(this.currentKey(userId, s));
    await this.cacheUser.del(...keys);
  }

  // ------------------------------------------------------------ cache hồ sơ người dùng

  async cacheUserProfile(userId: string, profile: unknown, ttlSeconds = 300): Promise<void> {
    try {
      await this.cacheUser.set(this.profileKey(userId), profile, { ex: ttlSeconds }); // Upstash tự serialize JSON
    } catch (err) {
      this.log.warn(`Không cache được hồ sơ người dùng: ${(err as Error).message}`);
    }
  }

  async getCachedUserProfile<T = unknown>(userId: string): Promise<T | null> {
    try {
      const data = await this.cacheUser.get<unknown>(this.profileKey(userId));
      if (!data) return null;
      return (typeof data === 'string' ? JSON.parse(data) : data) as T; // tương thích bản ghi cũ lưu dạng chuỗi
    } catch (err) {
      this.log.warn(`Không đọc được cache hồ sơ người dùng: ${(err as Error).message}`);
      return null;
    }
  }
}

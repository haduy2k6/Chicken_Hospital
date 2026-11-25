import { randomUUID } from 'crypto';
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { REFRESH_TTL_SECONDS } from '../common/utils/auth-cookie.util.js';
import refreshJwt from '../config/refresh-jwt.config.js';
import type { AuthUserDto, TokenResponseDto } from './dto/auth.dto.js';
import { User, UserRole } from '../entities/user.entity.js';
import { RedisUser } from '../redis/redis.service.js';
import type { ProviderIdentity } from './auth.types.js';

const PROFILE_TTL_SECONDS = 300;
const PROFILE_FIELDS = { id: true, activeRole: true, name: true, email: true, avatar: true } as const;
const SESSION_MAX_SECONDS = 30 * 24 * 3600;

const nowSec = () => Math.floor(Date.now() / 1000);

export interface VerifiedPayload {
  sub: string;
  sid?: string;
  sat?: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly redisCache: RedisUser,
    @Inject(refreshJwt.KEY) private readonly refreshKey: ConfigType<typeof refreshJwt>,
    private readonly jwtService: JwtService,
  ) {}

  async signInWithProvider(identity: ProviderIdentity): Promise<AuthUserDto> {
    const user = await this.upsertUser(identity);
    const profile = this.toProfile(user);
    await this.cacheProfile(user.id, profile);
    return profile;
  }

  private findByProvider(identity: ProviderIdentity): Promise<User | null> {
    return this.userRepository.findOne({
      where: { provider: identity.provider, providerId: identity.providerId },
      select: PROFILE_FIELDS,
    });
  }

  private async upsertUser(identity: ProviderIdentity): Promise<User> {
    const existing = await this.findByProvider(identity);
    const user =
      existing ??
      this.userRepository.create({
        provider: identity.provider,
        providerId: identity.providerId,
        activeRole: UserRole.PATIENT,
      });

    const changed = this.applyProfile(user, identity);
    if (existing && !changed) return user;

    try {
      return await this.userRepository.save(user);
    } catch (error) {
      if (existing) throw error;
      const raced = await this.findByProvider(identity);
      if (raced) return raced;
      throw error;
    }
  }

  private applyProfile(user: User, { name, email, avatar }: ProviderIdentity): boolean {
    let changed = false;
    if (name && user.name !== name) {
      user.name = name;
      changed = true;
    }
    if (email && user.email !== email) {
      user.email = email;
      changed = true;
    }
    if (avatar && user.avatar !== avatar) {
      user.avatar = avatar;
      changed = true;
    }
    return changed;
  }

  private toProfile(user: User): AuthUserDto {
    return { userId: user.id, role: user.activeRole, name: user.name, email: user.email, avatar: user.avatar };
  }

  private cacheProfile(userId: string, profile: AuthUserDto): Promise<void> {
    return this.redisCache.cacheUserProfile(userId, profile, PROFILE_TTL_SECONDS);
  }
  async startSession(userId: string): Promise<string> {
    const sid = randomUUID();
    const refreshToken = await this.jwtService.signAsync({ sub: userId, sid, sat: nowSec() }, this.refreshKey);
    await this.redisCache.saveRefresh(refreshToken, userId, sid, REFRESH_TTL_SECONDS);
    return refreshToken;
  }

  /** Giữ nguyên sid và sat của phiên: refresh không được tạo phiên mới hay kéo dài hạn tuyệt đối. */
  private async issueTokens(userId: string, sid: string, sat: number) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ sub: userId, sid }),
      this.jwtService.signAsync({ sub: userId, sid, sat }, this.refreshKey),
    ]);
    await this.redisCache.saveRefresh(refreshToken, userId, sid, REFRESH_TTL_SECONDS);
    return { accessToken, refreshToken };
  }

  async refreshTokens(userId: string, sid: string, incomingRefreshToken: string, sat?: number): Promise<TokenResponseDto> {
    const startedAt = sat ?? nowSec();
    if (nowSec() - startedAt > SESSION_MAX_SECONDS) {
      await this.redisCache.revokeSession(userId, sid);
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    }

    const locked = await this.redisCache.acquireRefreshLock(userId, sid);
    if (!locked) throw new HttpException('Phiên đang được làm mới, vui lòng thử lại', HttpStatus.TOO_MANY_REQUESTS);

    try {
      const state = await this.redisCache.checkRefresh(incomingRefreshToken, userId, sid);
      if (state === 'invalid') {
        await this.redisCache.revokeSession(userId, sid);
        throw new UnauthorizedException('Phiên làm việc không hợp lệ hoặc đã hết hạn');
      }

      let profile: AuthUserDto;
      try {
        profile = await this.getProfile(userId, true);
      } catch (err) {
        await this.redisCache.revokeSession(userId, sid);
        throw err;
      }

      const { accessToken, refreshToken } = await this.issueTokens(userId, sid, startedAt);
      return { accessToken, refreshToken, role: profile.role, name: profile.name, email: profile.email, avatar: profile.avatar };
    } finally {
      await this.redisCache.releaseRefreshLock(userId, sid);
    }
  }

  async logoutSession(userId: string, sid: string): Promise<void> {
    await this.redisCache.revokeSession(userId, sid);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.redisCache.revokeAllSessions(userId);
  }

  async getProfile(userId: string, fresh = false): Promise<AuthUserDto> {
    if (!fresh) {
      const cached = await this.redisCache.getCachedUserProfile<AuthUserDto>(userId);
      if (cached) return cached;
    }

    const user = await this.userRepository.findOne({ where: { id: userId }, select: PROFILE_FIELDS });
    if (!user) throw new UnauthorizedException('Người dùng không tồn tại hoặc đã bị thu hồi quyền');

    const profile = this.toProfile(user);
    void this.redisCache.cacheUserProfile(userId, profile, PROFILE_TTL_SECONDS);
    return profile;
  }

  async verifyRefreshToken(token: string): Promise<VerifiedPayload | null> {
    try {
      return await this.jwtService.verifyAsync<VerifiedPayload>(token, {
        secret: this.refreshKey.secret,
        algorithms: ['HS256'],
      });
    } catch {
      return null;
    }
  }

  async verifyAccessTokenIgnoringExpiry(token: string): Promise<VerifiedPayload | null> {
    try {
      return await this.jwtService.verifyAsync<VerifiedPayload>(token, {
        ignoreExpiration: true,
        algorithms: ['HS256'],
      });
    } catch {
      return null;
    }
  }
  async resolveLogoutPayload(refreshToken?: string | null, accessToken?: string | null): Promise<VerifiedPayload | null> {
    const fromRefresh = refreshToken ? await this.verifyRefreshToken(refreshToken) : null;
    return fromRefresh ?? (accessToken ? await this.verifyAccessTokenIgnoringExpiry(accessToken) : null);
  }
}

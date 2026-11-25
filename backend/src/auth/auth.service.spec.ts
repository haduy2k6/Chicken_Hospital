import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import type { ProviderIdentity } from './auth.types.js';
import { UserRole } from '../entities/user.entity.js';

const identity: ProviderIdentity = {
  provider: 'google',
  providerId: 'g-1',
  name: 'Bác sĩ A',
  email: 'a@example.com',
  avatar: 'https://example.com/a.png',
};

function setup() {
  const repo = {
    findOne: vi.fn(),
    create: vi.fn((data: object) => ({ ...data })),
    save: vi.fn(async (user: object) => ({ id: 'u1', ...user })),
  };
  const redis = { cacheUserProfile: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(repo as never, redis as never, {} as never, {} as never);
  return { service, repo, redis };
}

describe('AuthService.signInWithProvider', () => {
  it('tạo user mới với vai trò patient rồi cache profile', async () => {
    const { service, repo, redis } = setup();
    repo.findOne.mockResolvedValue(null);

    const result = await service.signInWithProvider(identity);

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google', providerId: 'g-1', activeRole: UserRole.PATIENT,
    }));
    expect(result).toEqual({
      userId: 'u1', role: UserRole.PATIENT, name: identity.name, email: identity.email, avatar: identity.avatar,
    });
    expect(redis.cacheUserProfile).toHaveBeenCalledWith('u1', result, 300);
  });

  it('không ghi DB khi profile Google không đổi', async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValue({ id: 'u1', ...identity, activeRole: UserRole.PATIENT });

    await service.signInWithProvider(identity);

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('cập nhật profile khi Google đổi tên/ảnh', async () => {
    const { service, repo } = setup();
    repo.findOne.mockResolvedValue({
      id: 'u1', provider: 'google', providerId: 'g-1', activeRole: UserRole.PATIENT,
      name: 'Tên cũ', email: identity.email, avatar: 'avatar-cũ',
    });

    const result = await service.signInWithProvider(identity);

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: identity.name, avatar: identity.avatar }));
    expect(result.name).toBe(identity.name);
  });

  it('xử lý race condition: user do request khác tạo thì dùng user đó', async () => {
    const { service, repo } = setup();
    const raced = { id: 'u2', ...identity, activeRole: UserRole.PATIENT };
    repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    repo.save.mockRejectedValueOnce(new Error('unique violation'));

    const result = await service.signInWithProvider(identity);

    expect(result.userId).toBe('u2');
    expect(repo.findOne).toHaveBeenCalledTimes(2);
  });
});

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { DoctorProfile } from '../../entities/doctor.entity.js';
import { RedisUser } from '../../redis/redis.service.js';
import { DOCTOR_CACHE, type DoctorCtx } from '../doctor.types.js';

type DoctorRequest = Request & { user?: AuthenticatedUser & { doctor?: DoctorCtx } };

@Injectable()
export class VerifiedDoctorGuard implements CanActivate {
  constructor(
    @InjectRepository(DoctorProfile) private readonly doctors: Repository<DoctorProfile>,
    private readonly redis: RedisUser,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DoctorRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Chưa đăng nhập');

    // Chỉ cache kết quả hợp lệ; loader ném Forbidden thì không bị cache.
    user.doctor = await this.redis.remember<DoctorCtx>(DOCTOR_CACHE.ctx(user.userId), DOCTOR_CACHE.ttlSeconds, async () => {
      const profile = await this.doctors.findOne({
        where: { userId: user.userId },
        select: { id: true, userId: true, isVerified: true, licenseNumber: true, specialties: { id: true } },
        relations: { specialties: true },
      });
      if (!profile?.isVerified || !profile.licenseNumber || profile.specialties.length === 0) {
        throw new ForbiddenException('Tài khoản bác sĩ chưa được xác minh chuyên khoa và giấy phép hành nghề');
      }
      return { id: profile.id, userId: profile.userId, specialtyIds: profile.specialties.map((s) => s.id) };
    });

    return true;
  }
}

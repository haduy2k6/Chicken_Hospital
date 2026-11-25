import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.types.js';
import { Roles } from '../decorators/roles.decorator.js';
import type { UserRole } from '../dto/auth.dto.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(Roles, [context.getHandler(), context.getClass()]);
    if (!roles?.length) throw new ForbiddenException('Tài nguyên chưa được khai báo quyền truy cập');

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Chưa đăng nhập');
    if (!user.role) throw new ForbiddenException('Không xác định được quyền người dùng');
    if (!roles.includes(user.role)) {
      throw new ForbiddenException(`Quyền ${user.role} không được phép truy cập tài nguyên này.`);
    }
    return true;
  }
}

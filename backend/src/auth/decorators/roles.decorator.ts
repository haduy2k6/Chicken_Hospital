import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../entities/user-role.enum.js';

export const Roles = Reflector.createDecorator<UserRole[]>();

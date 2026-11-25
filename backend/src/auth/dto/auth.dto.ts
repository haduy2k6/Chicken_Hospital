import { UserRole } from '../../entities/user-role.enum.js';
import type { SiteRole } from '../../entities/user-role.enum.js';

export { UserRole };
export type { SiteRole };

export const toSiteRole = (role?: UserRole | SiteRole): SiteRole =>
  role === UserRole.DOCTOR ? UserRole.DOCTOR : UserRole.PATIENT;

export interface TokenResponseDto {
  accessToken?: string;
  refreshToken?: string;
  role?: SiteRole;
  name?: string;
  email?: string;
  avatar?: string;
}

export interface AuthUserDto {
  userId: string;
  role: UserRole;
  name?: string;
  email?: string;
  avatar?: string;
}

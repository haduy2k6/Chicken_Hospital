export interface DoctorCtx {
  id: string;
  userId: string;
  specialtyIds: string[];
}

export const DOCTOR_CACHE = {
  ctx: (userId: string) => `doctor:ctx:${userId}`,
  publicList: 'doctors:public',
  referralTargets: 'doctors:referral-targets',
  /** TTL cache Redis */
  ttlSeconds: 300,
} as const;

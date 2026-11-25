/** Nguồn duy nhất của vai trò người dùng. */
export enum UserRole {
  DOCTOR = 'doctor',
  PATIENT = 'patient',
}

/** Giá trị role được trả về cho frontend / ghi vào cookie. */
export type SiteRole = `${UserRole}`;

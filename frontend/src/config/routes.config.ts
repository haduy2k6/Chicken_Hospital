import { ENV } from "./env.config";

export const APP_ROUTES = {
  HOME: "/",
  PATIENT: "/patient",
  DOCTOR: "/doctor",
  DOCTORS: "/doctors",
  APPOINTMENTS: "/appointments",
  ABOUT: "/about",
  SPECIALTIES: {
    ONCOLOGY: "/specialties/oncology",
    NEPHROLOGY: "/specialties/nephrology",
    CARDIOLOGY: "/specialties/cardiology",
  },
} as const;

export const API_ROUTES = {
  BASE_URL: ENV.apiUrl,
  AUTH: {
    /** Luôn đi qua rewrite /api của Next.js (cùng site với cookie). Mở bằng window.location, không fetch. Backend tự redirect về FRONT + locale. */
    GOOGLE_LOGIN: (locale: string) => `${ENV.apiUrl}/auth/google?locale=${encodeURIComponent(locale)}`,
    REFRESH: "/auth/refresh",
    LOGOUT: "/auth/logout",
  },
  PUBLIC_DOCTORS: "/doctors",
  PATIENT: {
    SUBMIT: "/patient",
    HISTORY: "/patient/history",
    DOCTORS: "/patient/doctors",
    APPOINTMENTS: "/patient/appointments",
    CANCEL_APPOINTMENT: (id: string) => `/patient/appointments/${id}/cancel`,
    CONFIRM_REFERRAL: (caseId: string) => `/patient/cases/${caseId}/confirm-referral`,
  },
  DOCTOR: {
    QUEUE: "/doctor/queue",
    REFERRAL_TARGETS: "/doctor/referral-targets",
    AVAILABILITY: "/doctor/availability",
    APPOINTMENTS: "/doctor/appointments",
    CASE_DETAIL: (caseId: string) => `/doctor/case/${caseId}`,
    REVIEW_CASE: (caseId: string) => `/doctor/review/${caseId}`,
  },
} as const;

/** Trang chủ theo vai trò: một nguồn duy nhất cho mọi chỗ điều hướng sau đăng nhập / sai vai trò */
export const homeFor = (role: "patient" | "doctor"): string =>
  role === "doctor" ? APP_ROUTES.DOCTOR : APP_ROUTES.PATIENT;
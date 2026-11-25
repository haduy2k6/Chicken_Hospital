interface HttpErrorLike {
  message?: string;
  response?: { status?: number; data?: { message?: string | string[]; code?: string } };
}

/** `t` lấy từ useTranslations("Common.errors") ở component gọi. */
export type ErrorTranslate = (key: string, values?: Record<string, string | number>) => string;

/** Mã lỗi 409 của backend; dùng khi không có translator (fallback tiếng Việt). */
const CONFLICT_MESSAGES: Record<string, string> = {
  SLOT_TAKEN: "Khung giờ hẹn đã có lịch hoặc bác sĩ đã đủ 3 ca trong ngày. Hãy chọn giờ khác.",
  VERSION_CONFLICT: "Ca bệnh vừa được cập nhật ở nơi khác. Hãy xem lại nội dung mới rồi gửi lại.",
};

const FALLBACK_MESSAGE = "Đã có lỗi xảy ra";

/** Thông báo lỗi từ phản hồi API (message có thể là mảng khi validate) */
export function errMsg(err: unknown, fallback = FALLBACK_MESSAGE, t?: ErrorTranslate): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as HttpErrorLike;
  const code = e.response?.data?.code;
  if (e.response?.status === 409 && code && CONFLICT_MESSAGES[code]) {
    return t ? t(`conflict.${code}`) : CONFLICT_MESSAGES[code];
  }
  const server = e.response?.data?.message;
  if (server) return [server].flat().join(", ");
  return e.message?.trim() || fallback;
}

export const genericErrorMessage = (t?: ErrorTranslate): string => (t ? t("generic") : FALLBACK_MESSAGE);

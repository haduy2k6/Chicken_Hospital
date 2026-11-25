// Hạn mức do backend tính. File này chỉ giữ câu chữ hiển thị.
import type { QuotaState } from "./types";

export type { QuotaState };

/** `t` lấy từ useTranslations("Patient") ở component gọi. */
type PatientTranslate = (key: string, values?: Record<string, string | number>) => string;

export const shortId = (id: string) => `#${id.slice(0, 8)}`;

const FALLBACK_BLOCKED =
  "Bạn đã dùng hết lượt gửi. Hãy xác nhận chuyển tuyến hoặc chờ hoàn tất lịch hẹn ở trang Lịch khám để giải phóng lượt.";

/** Giữ lại để tương thích với call site cũ; component nên dùng blockedMessage(t). */
export const BLOCKED_MESSAGE = FALLBACK_BLOCKED;

export function blockedMessage(t?: PatientTranslate): string {
  return t ? t("quota.blocked") : FALLBACK_BLOCKED;
}

export function confirmContinueMessage(t?: PatientTranslate): string {
  return t ? t("quota.confirmContinue") : "Tiếp tục gửi?";
}

export function describeEviction(e: NonNullable<QuotaState["eviction"]>, t?: PatientTranslate): string {
  const caseId = shortId(e.caseId);
  if (t) {
    return t(e.reason === "reviewed" ? "quota.eviction.reviewed" : "quota.eviction.pending", { caseId });
  }
  return e.reason === "reviewed"
    ? `Bạn đã dùng hết lượt gửi. Hồ sơ ${caseId} (đã có kết luận, cũ nhất) sẽ tự động bị xóa để nhường chỗ cho hồ sơ mới.`
    : `Tất cả hồ sơ đều đang chờ bác sĩ. Hồ sơ gửi gần nhất ${caseId} sẽ bị thay thế bằng hồ sơ mới.`;
}

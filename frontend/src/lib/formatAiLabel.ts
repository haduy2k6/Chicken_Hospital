/** `t` lấy từ useTranslations("Common.ai") ở component gọi. */
type AiTranslate = (key: string, values?: Record<string, string | number>) => string;

export function formatAiLabel(label: string | null, t?: AiTranslate): string {
  if (t) {
    if (label === "malignant") return t("malignant");
    if (label === "benign") return t("benign");
    return t("unknown");
  }
  if (label === "malignant") return "Mô hình ghi nhận tín hiệu cần bác sĩ đánh giá";
  if (label === "benign") return "Mô hình chưa ghi nhận tín hiệu; không loại trừ bệnh";
  return "Đã có đầu ra từ mô hình";
}

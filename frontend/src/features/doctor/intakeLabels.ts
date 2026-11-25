// Nhãn hiển thị cho intakeData (khóa camelCase do backend lưu, xem backend case-support/intake-schema.ts).
// Bảng tiếng Việt giữ làm fallback; component truyền `t` từ useTranslations() (root) để dịch theo locale.
export const INTAKE_LABELS: Record<string, string> = {
  age: "Tuổi",
  gender: "Giới tính",
  tobacco: "Hút thuốc lá",
  alcohol: "Uống rượu bia",
  betelQuid: "Nhai trầu",
  hpv: "Nhiễm HPV",
  sunExposure: "Phơi nắng kéo dài",
  oralHygiene: "Vệ sinh răng miệng kém",
  familyHistory: "Tiền sử gia đình mắc ung thư",
  immune: "Suy giảm miễn dịch",
  diet: "Chế độ ăn rau quả",
  lesions: "Tổn thương trong miệng",
  bleeding: "Chảy máu bất thường",
  swallowing: "Khó nuốt",
  patches: "Mảng trắng/đỏ trong miệng",
  creatinine: "Creatinine máu (mg/dL)",
  systolic: "Huyết áp tâm thu (mmHg)",
  diastolic: "Huyết áp tâm trương (mmHg)",
  proteinuria: "Protein niệu",
};

const INTAKE_LABEL_KEYS: Record<string, string> = {
  age: "Patient.form.fields.age",
  gender: "Patient.form.fields.gender",
  tobacco: "Patient.form.fields.tobacco",
  alcohol: "Patient.form.fields.alcohol",
  betelQuid: "Patient.form.fields.betelQuid",
  hpv: "Patient.form.fields.hpv",
  sunExposure: "Patient.form.fields.sunExposure",
  oralHygiene: "Patient.form.fields.oralHygiene",
  familyHistory: "Patient.form.fields.familyHistory",
  immune: "Patient.form.fields.immune",
  diet: "Patient.form.fields.diet",
  lesions: "Patient.form.fields.lesions",
  bleeding: "Patient.form.fields.bleeding",
  swallowing: "Patient.form.fields.swallowing",
  patches: "Patient.form.fields.patches",
  creatinine: "NephrologyForm.fields.creatinine",
  systolic: "NephrologyForm.fields.systolic",
  diastolic: "NephrologyForm.fields.diastolic",
  proteinuria: "NephrologyForm.fields.proteinuria",
};

const VALUE_LABELS: Record<string, string> = {
  Yes: "Có", No: "Không",
  Male: "Nam", Female: "Nữ", Other: "Khác",
  Low: "Thấp", Moderate: "Trung bình", High: "Cao",
  negative: "Âm tính", trace: "Vết", "1plus": "1+", "2plus": "2+", "3plus": "3+",
};

const VALUE_LABEL_KEYS: Record<string, string> = {
  Yes: "Patient.form.options.yes",
  No: "Patient.form.options.no",
  Male: "Patient.form.options.male",
  Female: "Patient.form.options.female",
  Other: "Patient.form.options.other",
  Low: "Patient.form.options.low",
  Moderate: "Patient.form.options.moderate",
  High: "Patient.form.options.high",
  negative: "NephrologyForm.options.proteinuria.negative",
  trace: "NephrologyForm.options.proteinuria.trace",
  "1plus": "NephrologyForm.options.proteinuria.1plus",
  "2plus": "NephrologyForm.options.proteinuria.2plus",
  "3plus": "NephrologyForm.options.proteinuria.3plus",
};

/** Chuyển intakeData thành danh sách {nhãn, giá trị} để panel bác sĩ hiển thị */
export function describeIntake(
  data: Record<string, unknown>,
  t?: (key: string, values?: Record<string, string | number>) => string,
): { key: string; label: string; value: string }[] {
  return Object.entries(data).map(([key, v]) => {
    const labelKey = INTAKE_LABEL_KEYS[key];
    const valueKey = VALUE_LABEL_KEYS[String(v)];
    return {
      key,
      label: t && labelKey ? t(labelKey) : INTAKE_LABELS[key] ?? key,
      value: t && valueKey ? t(valueKey) : VALUE_LABELS[String(v)] ?? String(v),
    };
  });
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Status, usePatientStore } from "@/src/stores/patientStore";
import { DropZone } from "./DropZone.client";
import { PatientForm, PATIENT_FORM_ID } from "./PatientForm.client";
import { usePatientHistoryQuery, usePatientQuota, useSubmitPatientMutation } from "@/src/query/usePatientQueries";
import { BLOCKED_MESSAGE, describeEviction, shortId, type QuotaState } from "@/src/features/patient/Quota";
import { errMsg } from "@/src/lib/httpError";
import { Link, useRouter } from "@/src/i18n/routing";
import { APP_ROUTES } from "@/src/config/routes.config";

const SPECIALTY = "oncology";
const STEPS = ["upload", "info"] as const;

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800 focus-visible:ring-offset-2 disabled:cursor-not-allowed";

export function UploadStep() {
  const t = useTranslations("Patient");
  const router = useRouter();
  const status = usePatientStore((s) => s.status);
  const goToForm = usePatientStore((s) => s.goToForm);
  const backToUpload = usePatientStore((s) => s.backToUpload);
  const clearFiles = usePatientStore((s) => s.clearFiles);
  const storageError = usePatientStore((s) => s.error);
  const submissionSuccessMsg = usePatientStore((s) => s.submissionSuccessMsg);
  const setSubmissionSuccess = usePatientStore((s) => s.setSubmissionSuccess);
  const submitMutation = useSubmitPatientMutation();
  const quota = usePatientQuota();
  const { data: historyData } = usePatientHistoryQuery();
  const [error, setError] = useState<string | null>(null);

  // Kiểm tra xem bệnh nhân có hồ sơ ung bướu đang chờ kết quả AI hoặc bác sĩ hay không
  const hasPendingDiagnosis = useMemo(() => {
    if (!historyData?.items) return false;
    return historyData.items.some((item) => {
      const isAiPending = item.results.some(
        (r) => !r.status || r.status === "pending" || r.status === "dispatched" || r.status === "processing",
      );
      return isAiPending || (item.specialtyCode === SPECIALTY && item.status === "pending");
    });
  }, [historyData?.items]);

  const step = status === Status.post ? 1 : 0;
  const isSubmitting = submitMutation.isPending;
  const isFormLocked = isSubmitting || hasPendingDiagnosis;

  const handleSubmit = async (values: Record<string, string>) => {
    const { files } = usePatientStore.getState();
    setError(null);

    if (hasPendingDiagnosis) {
      setError("Bạn đang có hồ sơ chẩn đoán đang chờ xử lý. Vui lòng đợi đến khi có kết quả trước khi gửi tiếp.");
      return;
    }

    if (quota.blocked) {
      setError(BLOCKED_MESSAGE);
      return;
    }

    if (quota.eviction && !window.confirm(`${describeEviction(quota.eviction)}\n\nTiếp tục gửi?`)) return;

    try {
      const res = await submitMutation.mutateAsync({ specialty: SPECIALTY, files, formValues: values });
      const base = res.message || "Gửi hồ sơ và hình ảnh thành công!";
      setSubmissionSuccess(res.evictedCaseId ? `${base} (Đã xóa hồ sơ cũ ${shortId(res.evictedCaseId)})` : base);

      // Khóa và dọn sạch các tệp vừa gửi
      clearFiles();

      // Chuyển luôn người dùng sang trang lịch khám theo yêu cầu
      router.push(APP_ROUTES.APPOINTMENTS);
    } catch (err) {
      setError(errMsg(err, t("actions.error")));
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 rounded-2xl bg-white/70 p-4 shadow-lg ring-1 ring-amber-900/10 backdrop-blur-md sm:p-6">
      <Stepper current={step} />

      <QuotaNotice quota={quota} />

      {hasPendingDiagnosis && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-2 animate-fadeIn">
          <div className="flex items-start gap-2 font-semibold">
            <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0 animate-pulse" />
            <span>Hồ sơ chẩn đoán ung bướu của bạn đang được hệ thống phân tích.</span>
          </div>
          <p className="text-xs text-amber-800 pl-7 leading-relaxed">
            Hệ thống đang xử lý và đánh giá ảnh chẩn đoán của bạn. Vui lòng chờ đến khi có kết quả tại trang Lịch Khám trước khi gửi hồ sơ chẩn đoán mới.
          </p>
          <div className="pl-7 pt-1">
            <Link
              href={APP_ROUTES.APPOINTMENTS}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span>Xem tiến trình tại Lịch Khám</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {submissionSuccessMsg && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 font-medium animate-fadeIn">
          ✓ {submissionSuccessMsg}
        </div>
      )}

      {storageError && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {storageError}
        </p>
      )}

      {step === 0 ? (
        <DropZone disabled={isFormLocked} />
      ) : (
        <PatientForm onSubmit={handleSubmit} disabled={isFormLocked} />
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {step === 1 && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={backToUpload}
            className={`${BTN} border border-amber-900/20 bg-white text-amber-950 hover:bg-amber-50 cursor-pointer`}
          >
            {t("actions.back")}
          </button>
        )}

        <button
          type={step === 0 ? "button" : "submit"}
          form={PATIENT_FORM_ID}
          disabled={status === Status.empty || isSubmitting || quota.blocked || hasPendingDiagnosis}
          onClick={step === 0 ? goToForm : undefined}
          className={`${BTN} bg-red-800 text-amber-50 shadow-sm hover:bg-red-900 disabled:bg-amber-900/15 disabled:text-amber-900/50 disabled:shadow-none cursor-pointer`}
        >
          {isSubmitting && <Loader2 size={16} className="animate-spin" />}
          {hasPendingDiagnosis
            ? "Đang chờ kết quả chẩn đoán..."
            : step === 0
              ? t("actions.next")
              : isSubmitting
                ? t("actions.submitting")
                : t("actions.submit")}
        </button>
      </div>
    </div>
  );
}

function QuotaNotice({ quota }: { quota: QuotaState & { known: boolean } }) {
  const t = useTranslations("Patient");
  if (!quota.known || quota.used === 0) return null;

  if (quota.blocked) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{BLOCKED_MESSAGE}</span>
      </p>
    );
  }

  if (quota.eviction) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{describeEviction(quota.eviction)}</span>
      </p>
    );
  }

  return (
    <p className="text-xs text-amber-900/70">
      {t("quotaUsed", { used: quota.used, max: quota.max })}
    </p>
  );
}

function Stepper({ current }: { current: number }) {
  const t = useTranslations("Patient.steps");
  return (
    <ol className="flex w-full items-center gap-3">
      {STEPS.map((key, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={key} aria-current={active ? "step" : undefined} className="flex flex-1 items-center gap-2.5 last:flex-none">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                done || active ? "bg-red-800 text-amber-50" : "bg-amber-900/10 text-amber-900/60"
              }`}
            >
              {done ? <Check size={14} /> : i + 1}
            </span>
            <span className={`text-sm ${active ? "font-semibold text-red-900" : "text-amber-900/60"}`}>{t(key)}</span>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 transition-colors ${done ? "bg-red-800" : "bg-amber-900/20"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export default UploadStep;

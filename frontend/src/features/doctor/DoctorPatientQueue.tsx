"use client";

import { memo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Loader2,
  CircleSlash,
} from "lucide-react";
import {
  genderLabel,
  type AiStatus,
  type PatientQueueItem,
  type SpecialtyFilter,
  type StatusFilter,
} from "@/src/features/doctor/types";

const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "reviewed", "escalated"];
const SPECIALTY_FILTERS: SpecialtyFilter[] = ["all", "oncology", "nephrology", "cardiology"];

const BADGE_CLASS: Record<PatientQueueItem["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  reviewed: "bg-emerald-100 text-emerald-900",
  escalated: "bg-rose-100 text-rose-900",
};

export function AiRiskBadge({
  score,
  status,
}: {
  score: number | null;
  status: AiStatus;
}) {
  const t = useTranslations("DoctorQueue");
  if (status === "processing") {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-stone-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {t("ai.processing")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
        <CircleSlash className="w-3.5 h-3.5" />
        {t("ai.failed")}
      </span>
    );
  }
  if (score === null) {
    return <span className="text-xs font-semibold text-stone-500">{t("ai.noScore")}</span>;
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-stone-600">
      {t("ai.score", { score: Math.round(score * 10) / 10 })}
    </span>
  );
}

interface RowProps {
  item: PatientQueueItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onPrefetch: (id: string) => void;
}

const QueueRow = memo(function QueueRow({ item, isSelected, onSelect, onPrefetch }: RowProps) {
  const t = useTranslations("DoctorQueue");
  const tOptions = useTranslations("Patient.form.options");
  const locale = useLocale();

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => onPrefetch(item.id)}
      onFocus={() => onPrefetch(item.id)}
      aria-pressed={isSelected}
      className={`w-full text-left p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer bg-white ${
        isSelected
          ? "border-cyan-600 ring-2 ring-cyan-600/20 shadow-md"
          : "border-stone-200/80 hover:border-stone-300 hover:shadow-xs"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-black text-stone-900 text-sm sm:text-base truncate">
              {item.name}
            </span>
            <span className="text-xs text-stone-500">
              ({t("age", { age: item.age })}, {genderLabel(item.gender, tOptions)})
            </span>
          </div>
          <p className="text-xs text-stone-400">
            {t("caseId", { id: item.id.slice(0, 8) })}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${BADGE_CLASS[item.status]}`}>
            {t(`status.${item.status}`)}
          </span>
          <AiRiskBadge score={item.aiRiskScore} status={item.aiStatus} />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {new Date(item.submissionDate).toLocaleString(locale, {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </span>
        <span className="text-cyan-700 font-bold flex items-center gap-0.5">
          {t("viewCase")} <ArrowUpRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
});

interface DoctorPatientQueueProps {
  items: PatientQueueItem[];
  selectedCaseId: string | null;
  filterStatus: StatusFilter;
  filterSpecialty: SpecialtyFilter;
  isLoading: boolean;
  onSelectFilterStatus: (status: StatusFilter) => void;
  onSelectFilterSpecialty: (specialty: SpecialtyFilter) => void;
  onSelectCase: (caseId: string) => void;
  onPrefetchCase: (caseId: string) => void;
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold text-stone-500 mr-1">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            value === o.id
              ? "bg-stone-900 text-white shadow-xs"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DoctorPatientQueue({
  items,
  selectedCaseId,
  filterStatus,
  filterSpecialty,
  isLoading,
  onSelectFilterStatus,
  onSelectFilterSpecialty,
  onSelectCase,
  onPrefetchCase,
}: DoctorPatientQueueProps) {
  const t = useTranslations("DoctorQueue");
  const statusOptions = STATUS_FILTERS.map((id) => ({ id, label: t(`status.${id}`) }));
  const specialtyOptions = SPECIALTY_FILTERS.map((id) => ({ id, label: t(`specialty.${id}`) }));

  return (
    <div className="space-y-4">
      <div className="space-y-3 bg-white p-4 rounded-2xl border border-stone-200/80 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs font-bold text-stone-500">
            <Filter className="w-3.5 h-3.5" />
            {t("filter.label")}
          </span>
          <span className="text-xs font-medium text-stone-400">{t("count", { count: items.length })}</span>
        </div>
        <FilterGroup
          label={t("filter.status")}
          options={statusOptions}
          value={filterStatus}
          onChange={onSelectFilterStatus}
        />
        <FilterGroup
          label={t("filter.specialty")}
          options={specialtyOptions}
          value={filterSpecialty}
          onChange={onSelectFilterSpecialty}
        />
      </div>

      <div className="space-y-3">
        {isLoading && items.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-stone-200/80 shadow-xs">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-cyan-600 mb-3" />
            <p className="text-sm font-semibold text-stone-600">{t("loading")}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-stone-200/80 shadow-xs">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
            <p className="text-base font-bold text-stone-800">
              {t("empty.title")}
            </p>
            <p className="text-xs text-stone-500 mt-1">{t("empty.hint")}</p>
          </div>
        ) : (
          items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              isSelected={selectedCaseId === item.id}
              onSelect={onSelectCase}
              onPrefetch={onPrefetchCase}
            />
          ))
        )}
      </div>
    </div>
  );
}

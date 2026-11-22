import { UploadStep } from "@/components/UploadStep.client";
import { Microscope, Activity, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function OncologySpecialtyPage() {
   const t = useTranslations("Home.Oncology");
  return (
    <main className="min-h-screen bg-linear-to-b from-[#FFFDFB] via-[#FFF7F2] to-[#FFF0E8] px-4 pb-20 pt-24 sm:px-6 lg:px-8 flex flex-col items-center">
      <div className="w-full max-w-4xl text-center space-y-3 mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-100 border border-rose-200 text-rose-900 text-xs font-extrabold uppercase tracking-widest shadow-xs">
          <span>{t("badge")}</span>
        </div>

        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-stone-900 tracking-tight">
          {t("title")}
        </h1>

        <p className="text-xs sm:text-sm md:text-base text-stone-600 max-w-2xl mx-auto leading-relaxed">
          {t("feature1")}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-xs font-semibold text-stone-700">
          <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-full border border-stone-200 shadow-xs">
            <Microscope className="w-4 h-4 text-rose-600" /> {t("do")}
          </span>
          <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-full border border-stone-200 shadow-xs">
            <Activity className="w-4 h-4 text-cyan-600" />  {t("feature2")}
          </span>
          <span className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-full border border-stone-200 shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />  {t("modelSubtitle")}
          </span>
        </div>
      </div>

      <div className="w-full max-w-2xl">
        <div className="bg-rose-900 text-white p-4 rounded-t-2xl font-bold text-sm flex items-center justify-between">
          <span>{t("noticeText")}</span>
        </div>
        <UploadStep />
      </div>
    </main>
  );
}

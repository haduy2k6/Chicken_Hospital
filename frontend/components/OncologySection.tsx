import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/src/i18n/routing";
import { APP_ROUTES } from "@/src/config/routes.config";
import { ArrowRight } from "lucide-react";
import { ScrollShadow } from "@heroui/react/scroll-shadow";

const STAT_ITEMS = [
  {
    key: "late_detection",
    valueClass: "text-rose-600",
    cardClass: "bg-rose-50/70 border-rose-200/70",
  },
  {
    key: "early_survival",
    valueClass: "text-emerald-700",
    cardClass: "bg-emerald-50/80 border-emerald-200/80",
  },
  {
    key: "late_survival",
    valueClass: "text-amber-700",
    cardClass: "bg-amber-50/70 border-amber-200/70",
  },
] as const;

export default function OncologySection() {
  const t = useTranslations("Home.Oncology");

  return (
    <section
      id="oncology"
      className="relative w-full py-12 sm:py-16 px-4 sm:px-[6%] lg:px-[10%] flex flex-col lg:flex-row items-center justify-between gap-10 rounded-3xl bg-linear-to-br from-amber-50/50 via-white to-orange-50/40 shadow-xs"
    >
      <article className="flex-1 w-full max-w-2xl flex flex-col items-start gap-5 z-10 border border-amber-200/80 p-6 sm:p-8 rounded-3xl bg-white/80 backdrop-blur-xs shadow-sm">

        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-orange-100/90 border border-orange-200 text-orange-800 text-xs font-bold tracking-wide uppercase">
          <span>{t("badge")}</span>
        </div>
        <h2 className="text-2xl sm:text-4xl lg:text-[42px] font-black text-stone-900 leading-[1.15] tracking-tight">
          {t("title")}
        </h2>

        <ScrollShadow hideScrollBar className="w-full max-h-72 pr-1 space-y-4">
          <p className="text-sm sm:text-base text-stone-600 leading-relaxed">
            {t("whoReport")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {STAT_ITEMS.map(({ key, valueClass, cardClass }) => (
              <div
                key={key}
                className={`p-3.5 rounded-2xl border ${cardClass} flex flex-col justify-between gap-1`}
              >
                <span className={`text-xl sm:text-2xl font-extrabold tracking-tight ${valueClass}`}>
                  {t(`stats.${key}.value`)}
                </span>
                <p className="text-xs font-semibold text-stone-800 leading-snug">
                  {t(`stats.${key}.label`)}
                </p>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  {t(`stats.${key}.description`)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-3 text-sm text-stone-700 leading-relaxed font-medium bg-orange-50/60 p-4 rounded-2xl border border-orange-200/70">
            <p>{t("partnership")}</p>
          </div>
        </ScrollShadow>

        <div className="pt-1 flex flex-wrap items-center gap-4 w-full">
          <Link
            href={APP_ROUTES.SPECIALTIES.ONCOLOGY}
            className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full bg-linear-to-r from-orange-600 to-rose-600 hover:from-orange-700 hover:to-rose-700 text-white font-bold text-sm tracking-wide shadow-lg shadow-orange-500/25 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-[transform,box-shadow,background-color] duration-200"
          >
            <span>{t("ctaButton")}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </article>

      <div className="hidden md:flex flex-1 w-full max-w-md relative aspect-square items-center justify-center">
        <Image
          src="/s1.svg"
          width={380}
          height={380}
          sizes="(max-width: 1024px) 320px, 380px"
          loading="lazy"
          alt={t("title")}
          className="relative z-10 w-full h-auto max-w-95 object-contain"
        />
      </div>
    </section>
  );
}
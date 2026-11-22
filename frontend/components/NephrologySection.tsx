import { useTranslations } from "next-intl";
import Image from "next/image";

const KEYS = ["ckd", "stone", "nephrotic"] as const;
const IMAGES = ["/than1.jpg", "/than2.jpg", "/than3.jpg"];


export default function NephrologySection() {
  const t = useTranslations("Home.Kidney");

  return (
    <section id="nephrology" className="w-full py-16 px-4 sm:px-[5%] lg:px-[8%] flex flex-col items-center">
      <div className="w-full max-w-4xl text-center space-y-3 mb-12">
        <span className="text-gray-500 underline text-5xl font-bold">{t("badge")}</span>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-stone-900 tracking-tight">{t("title")}</h2>
        <p className="text-sm sm:text-base text-stone-600 max-w-2xl mx-auto leading-relaxed">{t("subtitle")}</p>
      </div>
<div className="grid grid-cols-3 gap-2 sm:gap-4 w-[90dvw] max-w-5xl pb-[10dvh]">
  {KEYS.map((key, i) => (
    <div
      key={key}
      className={`relative aspect-9/16 rounded-sm overflow-hidden ${i === 1 ? "translate-y-[10dvh]" : ""}`}
    >
      <Image src={IMAGES[i]} alt={t(`cards.${key}.name`)} fill sizes="30vw" className="object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/75 via-black/30 to-transparent" />

      <span className="absolute inset-x-0 bottom-0 p-3 sm:p-5 flex items-end gap-2 text-white text-xs sm:text-base lg:text-lg font-bold leading-tight tracking-tight">
        <span className="w-1 h-4 sm:h-5 shrink-0 bg-cyan-400" />
        {t(`cards.${key}.name`)}
      </span>
    </div>
  ))}
</div>
    </section>
  );
}
import { getVictoryProofCategoryTone } from "@/components/victory-room-visual";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

type VictoryCardShareLayoutProps = {
  snippet: VictoryShareSnippet;
};

/** Victory Card layout for modal preview and PNG capture (same visible tree). */
export function VictoryCardShareLayout({ snippet }: VictoryCardShareLayoutProps) {
  const tone = getVictoryProofCategoryTone(snippet.categoryLabel);
  const quoteLine = snippet.quote?.trim() || null;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br from-[#0c1018] to-[#070b12] px-5 py-5 sm:px-6 sm:py-6 ${tone.cardBorder} ${tone.cardShadow}`}
    >
      <div
        className={`pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full ${tone.cardAccent}`}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className={tone.pill}>{snippet.categoryLabel}</p>
        {snippet.dateLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-300">{snippet.dateLabel}</p>
        ) : null}
      </div>
      <div className={`my-4 border-t ${tone.cardDivider}`} />
      {quoteLine ? (
        <p className="text-lg leading-relaxed text-stone-50 sm:text-xl sm:leading-relaxed">
          &ldquo;{quoteLine}&rdquo;
        </p>
      ) : null}
      <p
        className={`text-base leading-relaxed sm:text-[17px] sm:leading-relaxed ${
          quoteLine ? "mt-3 text-stone-400" : "text-lg text-stone-50 sm:text-xl sm:leading-relaxed"
        }`}
      >
        {snippet.meaning}
      </p>
      <div className={`mt-6 border-t pt-4 ${tone.cardDivider}`}>
        <p className="text-sm font-semibold text-amber-200">
          {snippet.brandLine} · {snippet.brandUrl}
        </p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
          {snippet.tagline}
        </p>
      </div>
    </div>
  );
}

import {
  getVictoryProofCategoryTone,
  vrAccentLink,
  vrDivider,
  vrMomentCard,
} from "@/components/victory-room-visual";

type VictoryMomentCardProps = {
  categoryLabel?: string;
  headline: string;
  body: string;
  quote?: string | null;
  meaning?: string | null;
  dateLabel: string;
  groundedInEventTypes: string[];
  momentId?: string;
  onShareProof?: (momentId: string) => void;
};

export function VictoryMomentCard({
  categoryLabel,
  headline,
  body,
  quote,
  meaning,
  dateLabel,
  momentId,
  onShareProof,
}: VictoryMomentCardProps) {
  const label = categoryLabel?.trim() || headline.trim();
  const tone = getVictoryProofCategoryTone(label);
  const meaningLine = (meaning ?? body).trim();
  const quoteLine = quote?.trim() || null;

  return (
    <article className={`${vrMomentCard} ${tone.cardBorder}`}>
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl ${tone.cardGlow}`}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        {label ? <p className={tone.pill}>{label}</p> : null}
        {dateLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{dateLabel}</p>
        ) : null}
      </div>
      <div className={`${vrDivider} my-4`} />
      {quoteLine ? (
        <p className="relative text-lg leading-relaxed text-stone-50 sm:text-xl sm:leading-relaxed">
          &ldquo;{quoteLine}&rdquo;
        </p>
      ) : null}
      {meaningLine ? (
        <p
          className={`relative text-base leading-relaxed text-stone-400 sm:text-[17px] sm:leading-relaxed${
            quoteLine ? " mt-3" : " text-lg text-stone-100 sm:text-xl sm:leading-relaxed"
          }`}
        >
          {meaningLine}
        </p>
      ) : null}
      {momentId && onShareProof ? (
        <>
          <div className={`${vrDivider} my-4`} />
          <button
            type="button"
            onClick={() => onShareProof(momentId)}
            className={`${vrAccentLink} bg-transparent p-0 text-sm`}
          >
            Share this proof
          </button>
        </>
      ) : null}
    </article>
  );
}

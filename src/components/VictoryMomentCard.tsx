import { getVictoryProofCategoryTone, vrMomentCardBase } from "@/components/victory-room-visual";

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
  /** Resolved display copy — when set, overrides quote/meaning layout. */
  primaryText?: string;
  secondaryText?: string | null;
  showQuoteMarks?: boolean;
  mutedReceiptText?: string | null;
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
  primaryText,
  secondaryText,
  showQuoteMarks,
  mutedReceiptText,
}: VictoryMomentCardProps) {
  const label = categoryLabel?.trim() || headline.trim();
  const tone = getVictoryProofCategoryTone(label);

  const resolvedPrimary = primaryText?.trim() || null;
  const useResolved = Boolean(resolvedPrimary);

  let quotedPrimary: string | null = null;
  let unquotedPrimary: string | null = null;
  let meaningLine = "";

  if (useResolved) {
    if (showQuoteMarks) {
      quotedPrimary = resolvedPrimary;
      meaningLine = secondaryText?.trim() || "";
    } else {
      unquotedPrimary = resolvedPrimary;
      meaningLine = "";
    }
  } else {
    const legacyQuote = quote?.trim() || null;
    meaningLine = (meaning ?? body).trim();
    if (legacyQuote) {
      quotedPrimary = legacyQuote;
    } else if (meaningLine) {
      unquotedPrimary = meaningLine;
      meaningLine = "";
    }
  }

  const receiptLine = mutedReceiptText?.trim() || null;

  return (
    <article className={`${vrMomentCardBase} ${tone.cardBorder} ${tone.cardShadow}`}>
      <div
        className={`pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full blur-3xl ${tone.cardGlow}`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl ${tone.cardGlow}`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full ${tone.cardAccent}`}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        {label ? <p className={tone.pill}>{label}</p> : null}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {dateLabel ? (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-300">{dateLabel}</p>
          ) : null}
          {momentId && onShareProof ? (
            <button
              type="button"
              onClick={() => onShareProof(momentId)}
              aria-label="Share this Victory Card"
              className="text-xs font-medium text-amber-300/75 underline decoration-amber-500/35 underline-offset-2 transition hover:text-amber-200 hover:decoration-amber-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1018]"
            >
              Share
            </button>
          ) : null}
        </div>
      </div>
      <div className={`border-t my-4 ${tone.cardDivider}`} />
      {quotedPrimary ? (
        <p className="relative text-lg leading-relaxed text-stone-50 sm:text-xl sm:leading-relaxed">
          &ldquo;{quotedPrimary}&rdquo;
        </p>
      ) : null}
      {unquotedPrimary ? (
        <p className="relative text-lg leading-relaxed text-stone-100 sm:text-xl sm:leading-relaxed">
          {unquotedPrimary}
        </p>
      ) : null}
      {meaningLine ? (
        <p
          className={`relative text-base leading-relaxed text-stone-400 sm:text-[17px] sm:leading-relaxed${
            quotedPrimary ? " mt-3" : ""
          }`}
        >
          {meaningLine}
        </p>
      ) : null}
      {receiptLine ? (
        <p className="relative mt-3 text-sm leading-relaxed text-stone-500">{receiptLine}</p>
      ) : null}
    </article>
  );
}

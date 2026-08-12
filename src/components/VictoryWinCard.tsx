import { VictoryWinCardActions } from "@/components/VictoryWinCardActions";
import { VictoryWinMediaImage } from "@/components/VictoryWinMediaImage";
import { vrMomentCardBase } from "@/components/victory-room-visual";
import type { PublicWinMediaDto } from "@/lib/v2-win-public-read";

type VictoryWinCardProps = {
  displayTitle: string;
  displayBody: string;
  dateLabel: string;
  supportingQuote?: string | null;
  celebrationAppropriate?: boolean;
  /** Optional signed card photo from server enrichment. */
  media?: PublicWinMediaDto | null;
  /**
   * When all three are set, shows More menu (Edit + Delete).
   * Omitted → card has no actions (unchanged visual).
   */
  winId?: string | null;
  editHref?: string | null;
  expectedUpdatedAt?: string | null;
};

/**
 * Public v2_win card — title-first, no category pills, no share, no internal taxonomy.
 */
export function VictoryWinCard({
  displayTitle,
  displayBody,
  dateLabel,
  supportingQuote,
  celebrationAppropriate = true,
  media = null,
  winId = null,
  editHref = null,
  expectedUpdatedAt = null,
}: VictoryWinCardProps) {
  const quiet = celebrationAppropriate === false;
  const border = quiet ? "border-white/12" : "border-amber-500/30";
  const shadow = quiet
    ? "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.04)]"
    : "shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),0_0_40px_-20px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]";
  const accent = quiet
    ? "bg-gradient-to-b from-stone-400/25 via-stone-500/10 to-transparent"
    : "bg-gradient-to-b from-amber-400/45 via-amber-500/20 to-transparent";
  const divider = quiet ? "border-white/10" : "border-amber-500/20";
  const titleClass = quiet
    ? "font-serif text-xl font-semibold tracking-tight text-stone-200 sm:text-2xl"
    : "font-serif text-xl font-semibold tracking-tight text-stone-50 sm:text-2xl";
  const bodyClass = quiet
    ? "relative mt-3 text-base leading-relaxed text-stone-400 sm:text-[17px]"
    : "relative mt-3 text-base leading-relaxed text-stone-300 sm:text-[17px]";

  const quote = supportingQuote?.trim() || null;
  const title = displayTitle.trim();
  const body = displayBody.trim();

  const actionsReady =
    Boolean(winId?.trim()) &&
    Boolean(editHref?.trim()) &&
    Boolean(expectedUpdatedAt?.trim());

  return (
    <article className={`${vrMomentCardBase} ${border} ${shadow}`}>
      {!quiet ? (
        <>
          <div
            className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-amber-500/10 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/8 blur-2xl"
            aria-hidden
          />
        </>
      ) : null}
      <div
        className={`pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-full ${accent}`}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-start justify-between gap-2">
        <h3 className={`${titleClass} min-w-0 flex-1`}>{title}</h3>
        {dateLabel ? (
          <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            {dateLabel}
          </p>
        ) : null}
      </div>
      <div className={`border-t my-4 ${divider}`} />
      {media?.cardUrl ? (
        <VictoryWinMediaImage
          cardUrl={media.cardUrl}
          width={media.width}
          height={media.height}
        />
      ) : null}
      {body ? <p className={bodyClass}>{body}</p> : null}
      {quote ? (
        <p className="relative mt-4 text-base leading-relaxed text-stone-200 sm:text-lg">
          &ldquo;{quote}&rdquo;
        </p>
      ) : null}
      {actionsReady ? (
        <VictoryWinCardActions
          winId={winId!.trim()}
          editHref={editHref!.trim()}
          expectedUpdatedAt={expectedUpdatedAt!.trim()}
        />
      ) : null}
    </article>
  );
}

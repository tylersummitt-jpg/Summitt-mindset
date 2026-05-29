import { vrAccentLink, vrCategoryPill, vrDivider } from "@/components/victory-room-visual";

type VictoryMomentCardProps = {
  categoryLabel?: string;
  headline: string;
  body: string;
  dateLabel: string;
  groundedInEventTypes: string[];
  momentId?: string;
  onShareProof?: (momentId: string) => void;
};

export function VictoryMomentCard({
  categoryLabel,
  headline,
  body,
  dateLabel,
  momentId,
  onShareProof,
}: VictoryMomentCardProps) {
  const label = categoryLabel?.trim() || headline.trim();

  return (
    <article className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-[#0c1018]/95 to-[#070b12]/95 px-5 py-5 shadow-[0_8px_40px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-6 sm:py-6">
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-500/8 blur-3xl"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        {label ? <p className={vrCategoryPill}>{label}</p> : null}
        {dateLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{dateLabel}</p>
        ) : null}
      </div>
      <div className={`${vrDivider} my-4`} />
      <p className="relative text-lg leading-relaxed text-stone-100 sm:text-xl sm:leading-relaxed">{body}</p>
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

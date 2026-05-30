import { vrAccentLink, vrCategoryPill, vrDivider, vrMomentCard } from "@/components/victory-room-visual";

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
    <article className={vrMomentCard}>
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-500/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        {label ? <p className={vrCategoryPill}>{label}</p> : null}
        {dateLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{dateLabel}</p>
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

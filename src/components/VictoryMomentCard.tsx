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
  groundedInEventTypes,
  momentId,
  onShareProof,
}: VictoryMomentCardProps) {
  return (
    <article className="rounded-xl border border-stone-200 border-l-4 border-l-stone-500 bg-white p-4 shadow-sm">
      {categoryLabel?.trim() ? (
        <p className="text-sm font-semibold text-gray-900">{categoryLabel.trim()}</p>
      ) : headline.trim() ? (
        <p className="text-sm font-semibold text-gray-900">{headline.trim()}</p>
      ) : null}
      <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{body}</p>
      {dateLabel ? <p className="mt-3 text-[11px] leading-snug text-gray-500">{dateLabel}</p> : null}
      {momentId && onShareProof ? (
        <p className="mt-3">
          <button
            type="button"
            onClick={() => onShareProof(momentId)}
            className="text-xs font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white"
          >
            Share this proof
          </button>
        </p>
      ) : null}
    </article>
  );
}

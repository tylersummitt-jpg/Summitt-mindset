type VictoryMomentCardProps = {
  headline: string;
  body: string;
  dateLabel: string;
  groundedInEventTypes: string[];
  momentId?: string;
  onShareProof?: (momentId: string) => void;
};

export function VictoryMomentCard({
  headline,
  body,
  dateLabel,
  groundedInEventTypes,
  momentId,
  onShareProof,
}: VictoryMomentCardProps) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{headline}</p>
      <p className="mt-2 text-gray-900 leading-relaxed">{body}</p>
      {dateLabel ? <p className="mt-3 text-xs text-gray-500">{dateLabel}</p> : null}
      {groundedInEventTypes.length > 0 ? (
        <p className="mt-2 text-[11px] text-gray-400">
          Grounded in spine: {groundedInEventTypes.join(", ")}
        </p>
      ) : null}
      {momentId && onShareProof ? (
        <p className="mt-3">
          <button
            type="button"
            onClick={() => onShareProof(momentId)}
            className="text-sm font-medium text-gray-800 underline underline-offset-2 hover:text-gray-600"
          >
            Share this proof
          </button>
        </p>
      ) : null}
    </article>
  );
}

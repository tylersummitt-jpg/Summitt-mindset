import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import type { SeasonProofMomentDisplay } from "@/lib/v2-victory-season-proof-view";

type VictorySeasonProofListProps = {
  moments: SeasonProofMomentDisplay[];
  timeZone: string;
  heading?: string;
  intro?: string;
};

export function VictorySeasonProofList({
  moments,
  timeZone,
  heading = "Proof from this season",
  intro = "Moments saved from your real check-ins — nothing invented.",
}: VictorySeasonProofListProps) {
  if (moments.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">{intro}</p>
      <ul className="mt-5 space-y-4">
        {moments.map((m) => (
          <li key={m.id}>
            <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {m.categoryLabel}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-900">{m.body}</p>
              <p className="mt-3 text-xs text-gray-500">
                {formatVictoryRoomDate(m.occurredAt, timeZone)}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

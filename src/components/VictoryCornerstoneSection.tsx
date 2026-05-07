import type { VictoryMoment } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictoryCornerstoneSectionProps = {
  moments: VictoryMoment[];
  timeZone: string;
};

/**
 * Cornerstone moments — existing `VictoryMoment` rows only, rule-selected (no AI, no new copy).
 */
export function VictoryCornerstoneSection({ moments, timeZone }: VictoryCornerstoneSectionProps) {
  if (moments.length === 0) return null;

  return (
    <section
      className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
      aria-label="Cornerstone moments"
    >
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">Cornerstone moments</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        A few choices that still define you here.
      </p>
      <ul className="mt-5 space-y-3">
        {moments.map((m) => (
          <li key={m.id}>
            <article className="rounded-lg border border-stone-200 border-l-4 border-l-stone-500 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{m.headline}</p>
              <p className="mt-1.5 text-sm font-medium leading-relaxed text-gray-900">{m.body}</p>
              <p className="mt-2 text-[11px] text-gray-500">{formatVictoryRoomDate(m.occurredAt, timeZone)}</p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

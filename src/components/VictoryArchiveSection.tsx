import type { VictoryMoment } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictoryArchiveSectionProps = {
  moments: VictoryMoment[];
  timeZone: string;
};

/**
 * Lifetime proof — read-only, spine-derived; calmer rows (no share, no spine debug line).
 */
export function VictoryArchiveSection({ moments, timeZone }: VictoryArchiveSectionProps) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-gray-900">Lifetime proof</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Curated moments from your whole time in this commitment — not every check, only what held.
      </p>
      {moments.length === 0 ? (
        <p className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-5 text-sm text-gray-700 leading-relaxed">
          When you&apos;ve been in this commitment longer, more proof will gather here. The thread remembers
          honest answers.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {moments.map((m) => (
            <li key={m.id}>
              <article className="rounded-lg border border-gray-100 bg-white/90 p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{m.headline}</p>
                <p className="mt-2 text-gray-900 leading-relaxed">{m.body}</p>
                <p className="mt-3 text-xs text-gray-500">{formatVictoryRoomDate(m.occurredAt, timeZone)}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

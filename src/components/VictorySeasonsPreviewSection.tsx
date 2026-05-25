import type { VictoryPastSeason, VictoryRoomActiveSeason } from "@/lib/v2-victory-room-view";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictorySeasonsPreviewSectionProps = {
  activeSeason: VictoryRoomActiveSeason | null;
  pastSeasons: VictoryPastSeason[];
  timeZone: string;
};

function formatSeasonRange(
  startedAt: string,
  endedAt: string | null,
  timeZone: string
): string {
  const start = formatVictoryRoomDate(startedAt, timeZone);
  if (endedAt) {
    return `${start} — ${formatVictoryRoomDate(endedAt, timeZone)}`;
  }
  return `Started ${start}`;
}

export function VictorySeasonsPreviewSection({
  activeSeason,
  pastSeasons,
  timeZone,
}: VictorySeasonsPreviewSectionProps) {
  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">My Seasons</h2>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        Seasons mark chapters of your accountability — summaries and naming come later.
      </p>
      {activeSeason?.season_name ? (
        <div className="mt-5 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current</p>
          <p className="mt-1 text-base font-medium text-gray-900">{activeSeason.season_name}</p>
          <p className="mt-1 text-xs text-gray-600">
            {formatSeasonRange(activeSeason.started_at, null, timeZone)}
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-gray-700 leading-relaxed">Your first season is open.</p>
      )}
      {pastSeasons.length > 0 ? (
        <ul className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Past seasons</p>
          {pastSeasons.map((s) => (
            <li
              key={`${s.season_name}-${s.started_at}`}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <span className="font-medium text-gray-900">{s.season_name}</span>
              <span className="mt-1 block text-xs text-gray-500">
                {formatSeasonRange(s.started_at, s.ended_at, timeZone)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import type { SeasonGoalSnapshot } from "@/lib/v2-victory-season-proof-view";

type VictorySeasonHeaderProps = {
  seasonName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  goalSnapshot: SeasonGoalSnapshot;
  timeZone: string;
};

function formatRange(
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

function statusLabel(status: string): string {
  if (status === "active") return "Current season";
  if (status === "completed") return "Completed season";
  if (status === "archived") return "Past season";
  return "Season";
}

export function VictorySeasonHeader({
  seasonName,
  status,
  startedAt,
  endedAt,
  goalSnapshot,
  timeZone,
}: VictorySeasonHeaderProps) {
  return (
    <header className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {statusLabel(status)}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">{seasonName}</h1>
      <p className="mt-2 text-sm text-gray-600">{formatRange(startedAt, endedAt, timeZone)}</p>
      {goalSnapshot.title ? (
        <p className="mt-4 text-sm leading-relaxed text-gray-800">
          <span className="font-medium text-gray-900">Goal this season: </span>
          {goalSnapshot.title}
        </p>
      ) : null}
    </header>
  );
}

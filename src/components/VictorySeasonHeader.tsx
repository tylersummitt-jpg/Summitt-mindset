import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";
import type { SeasonGoalSnapshot } from "@/lib/v2-victory-season-proof-view";
import {
  vrBody,
  vrBodyMuted,
  vrLabel,
  vrSectionCard,
  vrSectionTitle,
} from "@/components/victory-room-visual";

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
  const active = status === "active";

  return (
    <header className={`${vrSectionCard} mb-10 ${active ? "border-amber-500/40" : "border-white/12"}`}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/25 to-transparent"
        aria-hidden
      />
      <p className={vrLabel}>{statusLabel(status)}</p>
      <h1 className={`${vrSectionTitle} mt-3`}>{seasonName}</h1>
      <p className={`${vrBodyMuted} mt-2 text-sm`}>{formatRange(startedAt, endedAt, timeZone)}</p>
      {goalSnapshot.title ? (
        <p className={`${vrBody} mt-4 text-stone-300`}>
          <span className="font-medium text-stone-200">Goal this season: </span>
          {goalSnapshot.title}
        </p>
      ) : null}
    </header>
  );
}

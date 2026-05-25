import Link from "next/link";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictoryEarlierChapterHeaderProps = {
  title: string;
  statusLabel: string;
  startedAt: string | null;
  endedAt: string | null;
  behaviorStatement: string | null;
  timeZone: string;
};

function formatRange(
  startedAt: string | null,
  endedAt: string | null,
  timeZone: string
): string {
  if (!startedAt) return "Dates unavailable";
  const start = formatVictoryRoomDate(startedAt, timeZone);
  if (endedAt) {
    return `${start} — ${formatVictoryRoomDate(endedAt, timeZone)}`;
  }
  return `Started ${start}`;
}

export function VictoryEarlierChapterHeader({
  title,
  statusLabel,
  startedAt,
  endedAt,
  behaviorStatement,
  timeZone,
}: VictoryEarlierChapterHeaderProps) {
  return (
    <header className="mb-8">
      <p className="mb-6 text-sm text-gray-500">
        <Link
          href="/dashboard/victory-room/history"
          className="font-medium text-gray-900 underline underline-offset-2"
        >
          ← Earlier chapters
        </Link>
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {statusLabel}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">{formatRange(startedAt, endedAt, timeZone)}</p>
      {behaviorStatement ? (
        <p className="mt-4 text-sm leading-relaxed text-gray-800">
          <span className="font-medium text-gray-900">Commitment: </span>
          {behaviorStatement}
        </p>
      ) : null}
    </header>
  );
}

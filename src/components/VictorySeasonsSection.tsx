import Link from "next/link";
import type { VictorySeasonCardData } from "@/lib/v2-victory-season-list";
import { formatVictoryRoomDate } from "@/lib/v2-victory-room-view";

type VictorySeasonsSectionProps = {
  currentSeason: VictorySeasonCardData | null;
  pastSeasons: VictorySeasonCardData[];
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

function SeasonCard({ card, timeZone }: { card: VictorySeasonCardData; timeZone: string }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50/60 px-4 py-3">
      <p className="text-base font-medium text-gray-900">{card.seasonName}</p>
      <p className="mt-1 text-xs text-gray-500">
        {formatSeasonRange(card.startedAt, card.endedAt, timeZone)}
      </p>
      {card.goalTitle ? (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Goal: </span>
          {card.goalTitle}
        </p>
      ) : null}
      {card.principleLivedTitle ? (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Principle lived: </span>
          {card.principleLivedTitle}
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-gray-700">{card.statusLine}</p>
      <Link
        href={card.detailHref}
        className="mt-3 inline-block text-sm font-medium text-gray-900 underline underline-offset-2"
      >
        View season proof
      </Link>
    </article>
  );
}

export function VictorySeasonsSection({
  currentSeason,
  pastSeasons,
  timeZone,
}: VictorySeasonsSectionProps) {
  return (
    <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">My Seasons</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        Each season is a chapter of your accountability — proof lives inside the season where it
        happened.
      </p>

      {currentSeason ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current</p>
          <div className="mt-2">
            <SeasonCard card={currentSeason} timeZone={timeZone} />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-gray-700 leading-relaxed">Your first season is open.</p>
      )}

      {pastSeasons.length > 0 ? (
        <div className="mt-6 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Past seasons</p>
          {pastSeasons.map((card) => (
            <SeasonCard key={card.seasonId} card={card} timeZone={timeZone} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

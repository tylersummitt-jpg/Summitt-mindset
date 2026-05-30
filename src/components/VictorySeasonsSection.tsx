import Link from "next/link";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconSeason } from "@/components/VictoryRoomIcons";
import {
  vrAccentLink,
  vrBody,
  vrBodyLarge,
  vrBodyMuted,
  vrIconCircle,
  vrLabel,
  vrSeasonActive,
  vrSeasonPast,
} from "@/components/victory-room-visual";
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

function SeasonCard({
  card,
  timeZone,
  active,
}: {
  card: VictorySeasonCardData;
  timeZone: string;
  active?: boolean;
}) {
  return (
    <article className={active ? vrSeasonActive : vrSeasonPast}>
      {active ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
          aria-hidden
        />
      ) : null}
      <div className="flex gap-4">
        <div className={`${vrIconCircle} ${active ? "" : "opacity-60"}`} aria-hidden>
          <VrIconSeason />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-xl font-semibold text-stone-50 sm:text-2xl">{card.seasonName}</p>
          <p className="mt-1.5 text-sm text-stone-400">
            {formatSeasonRange(card.startedAt, card.endedAt, timeZone)}
          </p>
          {card.goalTitle ? (
            <p className={`${vrBodyMuted} mt-3 text-sm`}>
              <span className="font-medium text-stone-400">Goal: </span>
              {card.goalTitle}
            </p>
          ) : null}
          {card.principleLivedTitle ? (
            <p className={`${vrBodyMuted} mt-2 text-sm`}>
              <span className="font-medium text-stone-400">Principle lived: </span>
              {card.principleLivedTitle}
            </p>
          ) : null}
          <p className={`${vrBody} mt-4 text-stone-400`}>{card.statusLine}</p>
          <Link href={card.detailHref} className={`${vrAccentLink} mt-4 inline-block`}>
            View season proof
          </Link>
        </div>
      </div>
    </article>
  );
}

export function VictorySeasonsSection({
  currentSeason,
  pastSeasons,
  timeZone,
}: VictorySeasonsSectionProps) {
  return (
    <VictoryRoomSectionShell
      title="My Seasons"
      subtitle="Each season is a chapter of your accountability — proof lives inside the season where it happened."
    >
      {currentSeason ? (
        <div className="mt-8">
          <p className={vrLabel}>Current chapter</p>
          <div className="relative mt-4">
            <SeasonCard card={currentSeason} timeZone={timeZone} active />
          </div>
        </div>
      ) : (
        <p className={`${vrBodyLarge} mt-8`}>Your first season is open.</p>
      )}

      {pastSeasons.length > 0 ? (
        <div className="mt-8 space-y-4">
          <p className={vrLabel}>Past chapters</p>
          {pastSeasons.map((card) => (
            <SeasonCard key={card.seasonId} card={card} timeZone={timeZone} />
          ))}
        </div>
      ) : null}
    </VictoryRoomSectionShell>
  );
}

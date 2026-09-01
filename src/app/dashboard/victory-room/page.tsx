import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VictoryCalendarSection } from "@/components/VictoryCalendarSection";
import { VictoryPatPrinciplesSection } from "@/components/VictoryPatPrinciplesSection";
import { VictoryPatReadSection } from "@/components/VictoryPatReadSection";
import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";
import { VictoryRoomTopCard } from "@/components/VictoryRoomTopCard";
import { VictorySeasonsSection } from "@/components/VictorySeasonsSection";
import {
  vrAccentLink,
  vrEvolutionNudge,
  vrPageGlow,
  vrPageInner,
  vrPageOuter,
  vrSectionCard,
} from "@/components/victory-room-visual";
import { loadPatReadForVictoryRoom } from "@/lib/v2-victory-pat-read-persist";
import { loadPatPrinciplesForVictoryRoom } from "@/lib/v2-victory-principles-persist";
import { loadVictorySeasonListForRoom } from "@/lib/v2-victory-season-list";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { resolveVictoryCalendarPageState } from "@/lib/v2-victory-calendar";
import { loadVictoryEvolutionNudge } from "@/lib/v2-victory-evolution-nudge";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull, isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import { loadVictoryRoomView } from "@/lib/v2-victory-room-view";
import {
  loadPublicVictoryWinsForUser,
  loadPublicVictoryWinsForUserLocalDay,
  loadVictoryWinMonthMarkersForUser,
  PUBLIC_WINS_RECENT_LIMIT,
  type PublicWinDto,
} from "@/lib/v2-win-public-read";

export const dynamic = "force-dynamic";

type VictoryRoomSearchParams = {
  month?: string;
  day?: string;
};

type PageProps = {
  searchParams?: Promise<VictoryRoomSearchParams> | VictoryRoomSearchParams;
};

async function resolveVictoryRoomSearchParams(
  searchParams: PageProps["searchParams"]
): Promise<VictoryRoomSearchParams> {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

export default async function VictoryRoomPage({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);
  const params = await resolveVictoryRoomSearchParams(searchParams);
  const todayKey = getDateKeyInTimezone(new Date(), timeZone);
  const currentMonthKey = todayKey.slice(0, 7);
  const calendarState = resolveVictoryCalendarPageState({
    requestedMonth: params.month,
    requestedDay: params.day,
    todayKey,
  }) ?? { monthKey: currentMonthKey, selectedDay: null };

  const [view, publicWins] = await Promise.all([
    loadVictoryRoomView(user.id, { timeZone }),
    loadPublicVictoryWinsForUser({
      clerkUserId: user.id,
      recentLimit: PUBLIC_WINS_RECENT_LIMIT,
    }),
  ]);

  let showUpdateGoalLink = false;
  let showEditIdentityLink = false;
  if (view.hasActiveV2Commitment) {
    const activeCommitment = await getActiveCommitment(user.id);
    const pending = activeCommitment ? getPendingResolutionOrNull(activeCommitment) : null;
    const pendingBlocksEdit =
      Boolean(pending) ||
      Boolean(activeCommitment && isSmsInboundPendingResolutionActionable(activeCommitment));
    const canEditFoundation =
      Boolean(activeCommitment?.id) &&
      !pendingBlocksEdit &&
      activeCommitment?.accountability_phase !== "low_pressure_reactivation";
    showUpdateGoalLink = canEditFoundation;
    showEditIdentityLink = canEditFoundation;
  }

  const displayName =
    view.profile.preferred_name?.trim() ||
    user.firstName?.trim() ||
    "there";

  const patRead = view.hasActiveV2Commitment
    ? await loadPatReadForVictoryRoom({
        clerkUserId: user.id,
        view,
        displayName,
        timezone: timeZone,
      })
    : null;

  const patPrinciples = view.hasActiveV2Commitment
    ? await loadPatPrinciplesForVictoryRoom({
        clerkUserId: user.id,
        view,
        timezone: timeZone,
      })
    : null;

  const seasonList = view.hasActiveV2Commitment
    ? await loadVictorySeasonListForRoom(user.id)
    : null;

  const evolutionNudge = view.hasActiveV2Commitment
    ? await loadVictoryEvolutionNudge({ clerkUserId: user.id })
    : null;

  let calendarCounts: Record<string, number> = {};
  let selectedWins: PublicWinDto[] = [];
  if (view.hasActiveV2Commitment) {
    const [markers, dayWins] = await Promise.all([
      loadVictoryWinMonthMarkersForUser({
        clerkUserId: user.id,
        timeZone,
        monthKey: calendarState.monthKey,
      }),
      calendarState.selectedDay
        ? loadPublicVictoryWinsForUserLocalDay({
            clerkUserId: user.id,
            timeZone,
            dayKey: calendarState.selectedDay,
          })
        : Promise.resolve([] as PublicWinDto[]),
    ]);
    calendarCounts = markers.counts;
    selectedWins = dayWins;
  }

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        {!view.hasActiveV2Commitment ? (
          <section className={`${vrSectionCard} border-amber-500/30`}>
            <h2 className="font-serif text-xl font-semibold text-stone-50">Not quite ready</h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-300">
              Victory Room reads your <strong className="font-semibold text-stone-100">active commitment</strong>{" "}
              and the honest back-and-forth in your text check-ins. If you do not have an active commitment yet,
              there is nothing to show — and that is okay.
            </p>
            <p className="mt-5">
              <Link href="/dashboard/commitment-setup" className={vrAccentLink}>
                Set up your commitment
              </Link>
            </p>
          </section>
        ) : (
          <>
            {evolutionNudge ? (
              <section className={vrEvolutionNudge}>
                <h2 className="text-base font-semibold text-amber-100 sm:text-lg">{evolutionNudge.headline}</h2>
                <p className="mt-3 text-base leading-relaxed text-stone-300">{evolutionNudge.body}</p>
                <Link href={evolutionNudge.href} className={`${vrAccentLink} mt-4 inline-block`}>
                  Review recommendation
                </Link>
              </section>
            ) : null}

            {view.commitment ? (
              <VictoryRoomTopCard
                profile={view.profile}
                commitment={view.commitment}
                showUpdateGoalLink={showUpdateGoalLink}
                showEditIdentityLink={showEditIdentityLink}
              />
            ) : null}

            <VictoryCalendarSection
              monthKey={calendarState.monthKey}
              currentMonthKey={currentMonthKey}
              todayKey={todayKey}
              selectedDay={calendarState.selectedDay}
              counts={calendarCounts}
              selectedWins={selectedWins}
              timeZone={timeZone}
            />

            <VictoryRecentProofSection
              totalActiveWins={publicWins.totalActiveWins}
              wins={publicWins.recentWins}
              timeZone={timeZone}
            />

            {patRead ? <VictoryPatReadSection read={patRead} /> : null}

            {patPrinciples ? <VictoryPatPrinciplesSection principles={patPrinciples} /> : null}

            {seasonList ? (
              <VictorySeasonsSection
                currentSeason={seasonList.currentSeason}
                pastSeasons={seasonList.pastSeasons}
                timeZone={timeZone}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

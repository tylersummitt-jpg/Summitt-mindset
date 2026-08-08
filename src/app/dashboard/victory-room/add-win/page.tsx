import { currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import {
  loadManualWinSeasonOptionsForUser,
  loadOwnedSeasonForManualWin,
} from "@/lib/v2-win-manual-persist";
import { formatUserFacingGoal } from "@/lib/v2-user-facing-goal";
import AddWinClient from "./add-win-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?:
    | Promise<{ seasonId?: string; from?: string }>
    | { seasonId?: string; from?: string };
};

async function resolveSearchParams(searchParams: PageProps["searchParams"]) {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

export default async function VictoryRoomAddWinPage({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);
  const params = await resolveSearchParams(searchParams);
  const seasonId =
    typeof params.seasonId === "string" && params.seasonId.trim()
      ? params.seasonId.trim()
      : null;
  const fromAll =
    typeof params.from === "string" && params.from.trim() === "all-wins";

  let lockedSeason: {
    seasonId: string;
    seasonName: string;
    goalLabel: string | null;
  } | null = null;

  if (seasonId) {
    const owned = await loadOwnedSeasonForManualWin({
      clerkUserId: user.id,
      seasonId,
    });
    if (!owned) {
      notFound();
    }
    const behavior =
      owned.goal_snapshot &&
      typeof owned.goal_snapshot === "object" &&
      typeof (owned.goal_snapshot as { behavior_statement?: unknown }).behavior_statement ===
        "string"
        ? String((owned.goal_snapshot as { behavior_statement: string }).behavior_statement)
        : null;
    lockedSeason = {
      seasonId: owned.id,
      seasonName: owned.season_name,
      goalLabel: behavior
        ? formatUserFacingGoal({ behaviorStatement: behavior })
        : null,
    };
  }

  const seasonOptions = lockedSeason
    ? []
    : await loadManualWinSeasonOptionsForUser({
        clerkUserId: user.id,
        timeZone,
      });

  const cancelHref = lockedSeason
    ? `/dashboard/victory-room/seasons/${lockedSeason.seasonId}`
    : fromAll
      ? "/dashboard/victory-room/all-proof"
      : "/dashboard/victory-room";

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        <AddWinClient
          timeZone={timeZone}
          defaultOccurredOn={getDateKeyInTimezone(new Date(), timeZone)}
          lockedSeason={lockedSeason}
          seasonOptions={seasonOptions}
          cancelHref={cancelHref}
        />
      </main>
    </div>
  );
}

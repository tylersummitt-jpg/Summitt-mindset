import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  fetchSeasonListHintsForRoom,
  type SeasonSummaryForDisplay,
} from "@/lib/v2-victory-season-summary-persist";
import { truncateSummaryTeaser } from "@/lib/v2-victory-season-summary-map";
import {
  ACTIVE_EVENT_FETCH_LIMIT,
  deriveMergedProofMomentsFromEventWindow,
  mapVictoryCommitmentEventRows,
} from "@/lib/v2-victory-room-view";

const PAST_SEASON_LIMIT = 5;

export type VictorySeasonCardData = {
  seasonId: string;
  commitmentId: string;
  seasonName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  goalTitle: string | null;
  hasSavedProof: boolean;
  summaryTeaser: string | null;
  principleLivedTitle: string | null;
  statusLine: string;
  detailHref: string;
  isCurrent: boolean;
};

export type VictorySeasonListForRoom = {
  currentSeason: VictorySeasonCardData | null;
  pastSeasons: VictorySeasonCardData[];
};

type SeasonListRow = {
  id: string;
  commitment_id: string;
  season_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  goal_snapshot: unknown;
};

function parseGoalTitle(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const title = (raw as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function parseGoalBehavior(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const behavior = (raw as Record<string, unknown>).behavior_statement;
  return typeof behavior === "string" && behavior.trim() ? behavior.trim() : null;
}

async function resolveLiveGoalTitleForActiveSeason(args: {
  clerkUserId: string;
  seasonCommitmentId: string;
  goalSnapshot: unknown;
}): Promise<string | null> {
  const snapshotTitle = parseGoalTitle(args.goalSnapshot);
  const snapshotBehavior = parseGoalBehavior(args.goalSnapshot);

  const { data: activeCommitment, error: activeErr } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "active")
    .maybeSingle();

  if (!activeErr && activeCommitment?.id) {
    const activeTitle =
      typeof activeCommitment.title === "string" && activeCommitment.title.trim()
        ? activeCommitment.title.trim()
        : null;
    const activeBehavior =
      typeof activeCommitment.behavior_statement === "string" &&
      activeCommitment.behavior_statement.trim()
        ? activeCommitment.behavior_statement.trim()
        : null;
    const fromActive = activeTitle ?? activeBehavior;

    if (activeCommitment.id !== args.seasonCommitmentId) {
      console.warn("[v2-victory-season-list] season_commitment_drift", {
        clerk_user_id: args.clerkUserId,
        season_commitment_id: args.seasonCommitmentId,
        active_commitment_id: activeCommitment.id,
      });
      if (fromActive) return fromActive;
    } else if (fromActive) {
      return fromActive;
    }
  }

  const { data: live, error } = await supabaseServer
    .from("v2_commitment")
    .select("title, behavior_statement")
    .eq("id", args.seasonCommitmentId)
    .maybeSingle();

  if (error || !live) {
    return snapshotTitle ?? snapshotBehavior;
  }

  const liveTitle =
    typeof live.title === "string" && live.title.trim() ? live.title.trim() : null;
  const liveBehavior =
    typeof live.behavior_statement === "string" && live.behavior_statement.trim()
      ? live.behavior_statement.trim()
      : null;
  return liveTitle ?? liveBehavior ?? snapshotTitle ?? snapshotBehavior;
}

/** One bounded event window + same derivation as season detail; used only for the active season card. */
async function hasCuratedProofForCommitment(commitmentId: string): Promise<boolean> {
  const { data: commitment, error: commitErr } = await supabaseServer
    .from("v2_commitment")
    .select("reactivation_entered_at")
    .eq("id", commitmentId)
    .maybeSingle();

  if (commitErr || !commitment) {
    return false;
  }

  const reactivationAt =
    commitment.reactivation_entered_at != null &&
    typeof commitment.reactivation_entered_at === "string"
      ? commitment.reactivation_entered_at
      : null;

  const { data: events, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .order("occurred_at", { ascending: false })
    .limit(ACTIVE_EVENT_FETCH_LIMIT);

  if (evErr) {
    console.error("[v2-victory-season-list] curated proof check failed", {
      commitment_id: commitmentId,
      message: evErr.message,
    });
    return false;
  }

  const eventRows = mapVictoryCommitmentEventRows(events ?? []);
  const { merged } = deriveMergedProofMomentsFromEventWindow({
    eventRowsFull: eventRows,
    reactivationEnteredAt: reactivationAt,
  });

  return merged.length > 0;
}

function buildStatusLine(args: {
  status: string;
  hasSavedProof: boolean;
  summaryTeaser: string | null;
}): string {
  if (args.status === "active") {
    if (!args.hasSavedProof) {
      return "This season is still building.";
    }
    return "Proof is forming in this season.";
  }

  if (!args.hasSavedProof) {
    return "Little was captured in text for this season.";
  }

  if (args.summaryTeaser) {
    return args.summaryTeaser;
  }

  return "Proof was saved for this season.";
}

function toCard(
  row: SeasonListRow,
  hasSavedProof: boolean,
  summary: SeasonSummaryForDisplay | undefined,
  isCurrent: boolean,
  goalTitleOverride?: string | null
): VictorySeasonCardData {
  const teaser =
    summary?.summaryText &&
    (summary.confidence === "medium" || summary.confidence === "high")
      ? truncateSummaryTeaser(summary.summaryText)
      : null;

  const principle =
    summary?.principleLivedTitle &&
    (summary.confidence === "medium" || summary.confidence === "high")
      ? summary.principleLivedTitle
      : null;

  return {
    seasonId: row.id,
    commitmentId: row.commitment_id,
    seasonName: row.season_name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    goalTitle: goalTitleOverride ?? parseGoalTitle(row.goal_snapshot),
    hasSavedProof,
    summaryTeaser: teaser,
    principleLivedTitle: principle,
    statusLine: buildStatusLine({
      status: row.status,
      hasSavedProof,
      summaryTeaser: teaser,
    }),
    detailHref: `/dashboard/victory-room/seasons/${row.id}`,
    isCurrent,
  };
}

export async function loadVictorySeasonListForRoom(
  clerkUserId: string
): Promise<VictorySeasonListForRoom> {
  const { data: activeRow, error: activeErr } = await supabaseServer
    .from("user_accountability_season")
    .select("id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeErr) {
    console.error("[v2-victory-season-list] active season load failed", {
      clerk_user_id: clerkUserId,
      message: activeErr.message,
    });
  }

  const { data: pastRows, error: pastErr } = await supabaseServer
    .from("user_accountability_season")
    .select("id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot")
    .eq("clerk_user_id", clerkUserId)
    .in("status", ["completed", "archived"])
    .order("started_at", { ascending: false })
    .limit(PAST_SEASON_LIMIT);

  if (pastErr) {
    console.error("[v2-victory-season-list] past seasons load failed", {
      clerk_user_id: clerkUserId,
      message: pastErr.message,
    });
  }

  const past = (pastRows ?? []) as SeasonListRow[];
  const pastSeasonIds = past.map((r) => r.id);
  const hintsMap = await fetchSeasonListHintsForRoom(clerkUserId, pastSeasonIds);

  let currentSeason: VictorySeasonCardData | null = null;
  if (activeRow) {
    const ar = activeRow as SeasonListRow;
    const hasSavedProof = await hasCuratedProofForCommitment(ar.commitment_id);
    const liveGoalTitle = await resolveLiveGoalTitleForActiveSeason({
      clerkUserId,
      seasonCommitmentId: ar.commitment_id,
      goalSnapshot: ar.goal_snapshot,
    });
    currentSeason = toCard(ar, hasSavedProof, undefined, true, liveGoalTitle);
  }

  const pastSeasons = past.map((row) => {
    const hint = hintsMap.get(row.id);
    const hasSavedProof = hint?.hasSavedProof ?? false;
    return toCard(row, hasSavedProof, hint?.summary, false);
  });

  return { currentSeason, pastSeasons };
}

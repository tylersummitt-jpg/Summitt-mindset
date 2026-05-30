import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { loadSeasonSummaryForDisplay, type SeasonSummaryForDisplay } from "@/lib/v2-victory-season-summary-persist";
import {
  ACTIVE_EVENT_FETCH_LIMIT,
  curateRecentProofMoments,
  deriveMergedProofMomentsFromEventWindow,
  getRecentProofCategoryLabel,
  mapVictoryCommitmentEventRows,
  SEASON_PROOF_DISPLAY_LIMIT,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

export type SeasonGoalSnapshot = {
  title: string | null;
  behaviorStatement: string | null;
};

export type SeasonProofMomentDisplay = {
  id: string;
  categoryLabel: string;
  headline: string;
  body: string;
  quote?: string | null;
  meaning?: string | null;
  occurredAt: string;
  groundedInEventTypes?: string[];
};

export type VictorySeasonProofView = {
  seasonId: string;
  commitmentId: string;
  seasonName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  goalSnapshot: SeasonGoalSnapshot;
  proofMoments: SeasonProofMomentDisplay[];
  proofMomentCount: number;
  hasProof: boolean;
  summary: SeasonSummaryForDisplay | null;
};

type SeasonRow = {
  id: string;
  clerk_user_id: string;
  commitment_id: string;
  season_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  goal_snapshot: unknown;
};

function parseGoalSnapshot(raw: unknown): SeasonGoalSnapshot {
  if (!raw || typeof raw !== "object") {
    return { title: null, behaviorStatement: null };
  }
  const g = raw as Record<string, unknown>;
  return {
    title: typeof g.title === "string" ? g.title.trim() || null : null,
    behaviorStatement:
      typeof g.behavior_statement === "string" ? g.behavior_statement.trim() || null : null,
  };
}

function mapProofMomentForDisplay(m: VictoryMoment): SeasonProofMomentDisplay {
  return {
    id: m.id,
    categoryLabel: getRecentProofCategoryLabel(m),
    headline: m.headline,
    body: m.body,
    quote: m.quote ?? null,
    meaning: m.meaning ?? m.body,
    occurredAt: m.occurredAt,
    groundedInEventTypes: m.groundedInEventTypes,
  };
}

export async function loadVictorySeasonProofView(args: {
  clerkUserId: string;
  seasonId: string;
}): Promise<VictorySeasonProofView | null> {
  const { data: season, error: seasonErr } = await supabaseServer
    .from("user_accountability_season")
    .select(
      "id, clerk_user_id, commitment_id, season_name, status, started_at, ended_at, goal_snapshot"
    )
    .eq("id", args.seasonId)
    .maybeSingle();

  if (seasonErr) {
    console.error("[v2-victory-season-proof-view] season load failed", {
      season_id: args.seasonId,
      message: seasonErr.message,
    });
    return null;
  }

  if (!season) return null;

  const row = season as SeasonRow;
  if (row.clerk_user_id !== args.clerkUserId) {
    return null;
  }

  const { data: commitment, error: commitErr } = await supabaseServer
    .from("v2_commitment")
    .select("id, reactivation_entered_at")
    .eq("id", row.commitment_id)
    .maybeSingle();

  if (commitErr || !commitment) {
    console.error("[v2-victory-season-proof-view] commitment load failed", {
      commitment_id: row.commitment_id,
      message: commitErr?.message,
    });
    return null;
  }

  const reactivationAt =
    commitment.reactivation_entered_at != null &&
    typeof commitment.reactivation_entered_at === "string"
      ? commitment.reactivation_entered_at
      : null;

  const { data: events, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", row.commitment_id)
    .order("occurred_at", { ascending: false })
    .limit(ACTIVE_EVENT_FETCH_LIMIT);

  if (evErr) {
    console.error("[v2-victory-season-proof-view] events load failed", {
      commitment_id: row.commitment_id,
      message: evErr.message,
    });
  }

  const eventRows = mapVictoryCommitmentEventRows(events ?? []);
  const { merged } = deriveMergedProofMomentsFromEventWindow({
    eventRowsFull: eventRows,
    reactivationEnteredAt: reactivationAt,
  });

  const curated: VictoryMoment[] = curateRecentProofMoments(
    merged,
    SEASON_PROOF_DISPLAY_LIMIT
  );

  const proofMomentCount = merged.length;
  const hasProof = curated.length > 0;

  const summary = await loadSeasonSummaryForDisplay({
    clerkUserId: args.clerkUserId,
    seasonId: row.id,
    commitmentId: row.commitment_id,
    seasonStatus: row.status,
    proofMoments: curated,
    proofMomentCount,
  });

  return {
    seasonId: row.id,
    commitmentId: row.commitment_id,
    seasonName: row.season_name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    goalSnapshot: parseGoalSnapshot(row.goal_snapshot),
    proofMoments: curated.map(mapProofMomentForDisplay),
    proofMomentCount,
    hasProof,
    summary,
  };
}

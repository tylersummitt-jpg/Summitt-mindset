import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  ACTIVE_EVENT_FETCH_LIMIT,
  curateRecentProofMoments,
  deriveMergedProofMomentsFromEventWindow,
  getRecentProofCategoryLabel,
  mapVictoryCommitmentEventRows,
  SEASON_PROOF_DISPLAY_LIMIT,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";
import { earlierChapterStatusLabel } from "@/lib/v2-victory-earlier-chapter-index";

const ELIGIBLE_STATUSES = ["completed", "abandoned", "superseded"] as const;

export type EarlierChapterProofMomentDisplay = {
  id: string;
  categoryLabel: string;
  headline: string;
  body: string;
  occurredAt: string;
};

export type VictoryEarlierChapterProofView = {
  commitmentId: string;
  title: string;
  status: string;
  statusLabel: string;
  startedAt: string | null;
  endedAt: string | null;
  behaviorStatement: string | null;
  proofMoments: EarlierChapterProofMomentDisplay[];
  hasCuratedProof: boolean;
  hasDerivedProofInWindow: boolean;
};

function truncateBody(body: string, max = 400): string {
  const t = body.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function chapterTitleFromRow(row: Record<string, unknown>): string {
  const t = typeof row.title === "string" ? row.title.trim() : "";
  if (t) return t.length > 120 ? `${t.slice(0, 119)}…` : t;
  const b = typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
  if (b) return b.length > 100 ? `${b.slice(0, 99)}…` : b;
  return "Earlier commitment";
}

function isEligibleStatus(status: string): boolean {
  return (ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export async function loadVictoryEarlierChapterProofView(args: {
  clerkUserId: string;
  commitmentId: string;
}): Promise<VictoryEarlierChapterProofView | null> {
  const { data: row, error: rowErr } = await supabaseServer
    .from("v2_commitment")
    .select(
      "id, clerk_user_id, title, behavior_statement, status, started_at, ended_at, reactivation_entered_at"
    )
    .eq("id", args.commitmentId)
    .maybeSingle();

  if (rowErr) {
    console.error("[v2-victory-earlier-chapter-proof-view] commitment load failed", {
      commitment_id: args.commitmentId,
      message: rowErr.message,
    });
    return null;
  }

  if (!row) return null;

  const commitment = row as Record<string, unknown>;
  if (String(commitment.clerk_user_id) !== args.clerkUserId) {
    return null;
  }

  const status = String(commitment.status ?? "");
  if (!isEligibleStatus(status)) {
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
    .eq("commitment_id", args.commitmentId)
    .order("occurred_at", { ascending: false })
    .limit(ACTIVE_EVENT_FETCH_LIMIT);

  if (evErr) {
    console.error("[v2-victory-earlier-chapter-proof-view] events load failed", {
      commitment_id: args.commitmentId,
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

  const hasCuratedProof = curated.length > 0;
  const hasDerivedProofInWindow = merged.length > 0;

  return {
    commitmentId: args.commitmentId,
    title: chapterTitleFromRow(commitment),
    status,
    statusLabel: earlierChapterStatusLabel(status),
    startedAt: typeof commitment.started_at === "string" ? commitment.started_at : null,
    endedAt: typeof commitment.ended_at === "string" ? commitment.ended_at : null,
    behaviorStatement:
      typeof commitment.behavior_statement === "string"
        ? commitment.behavior_statement.trim() || null
        : null,
    proofMoments: curated.map((m) => ({
      id: m.id,
      categoryLabel: getRecentProofCategoryLabel(m),
      headline: m.headline,
      body: truncateBody(m.body),
      occurredAt: m.occurredAt,
    })),
    hasCuratedProof,
    hasDerivedProofInWindow,
  };
}

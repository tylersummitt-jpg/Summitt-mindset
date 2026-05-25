import "server-only";

import { createHash } from "node:crypto";

import { supabaseServer } from "@/lib/supabase-server";
import { stableSerializeForHash } from "@/lib/v2-victory-pat-read-persist";
import type { PatReadPatternConfidence } from "@/lib/v2-victory-pat-read-persist";
import {
  buildDeterministicSeasonSummary,
  type SeasonSummaryConfidence,
} from "@/lib/v2-victory-season-summary-map";
import { getRecentProofCategoryLabel, type VictoryMoment } from "@/lib/v2-victory-room-view";

export type SeasonSummaryProvenance = "deterministic" | "ai" | "fallback";

export type SeasonSummaryUpdateReason =
  | "initial"
  | "source_hash_match"
  | "season_closed"
  | "weekly_refresh"
  | "first_real_proof"
  | "major_evidence_change"
  | "pat_read_changed"
  | "pat_principles_changed"
  | "fallback";

export type SeasonSummaryForDisplay = {
  summaryText: string | null;
  patternText: string | null;
  principleLivedTitle: string | null;
  confidence: SeasonSummaryConfidence;
};

export type SeasonSummarySourceBundle = {
  season_id: string;
  commitment_id: string;
  season_status: string;
  proof_moment_ids: string[];
  proof_category_labels: string[];
  proof_bodies: string[];
  proof_moment_count: number;
  pat_read_source_hash: string | null;
  pat_read_pattern_text: string | null;
  pat_read_pattern_confidence: PatReadPatternConfidence;
  pat_principles_source_hash: string | null;
  principle_lived_title: string | null;
};

function isClosedSeason(status: string): boolean {
  return status === "completed" || status === "archived";
}

export function getValidForSeasonKey(seasonId: string, status: string): string {
  if (status === "active") {
    return `season:${seasonId}:active`;
  }
  return `season:${seasonId}:closed`;
}

export function computeSeasonSummarySourceHash(bundle: SeasonSummarySourceBundle): string {
  return createHash("sha256").update(stableSerializeForHash(bundle)).digest("hex");
}

export function computeSeasonSummarySourceBundle(args: {
  seasonId: string;
  commitmentId: string;
  seasonStatus: string;
  proofMoments: VictoryMoment[];
  proofMomentCount: number;
  patReadSourceHash?: string | null;
  patReadPatternText?: string | null;
  patReadPatternConfidence?: PatReadPatternConfidence;
  patPrinciplesSourceHash?: string | null;
  principleLivedTitle?: string | null;
}): SeasonSummarySourceBundle {
  return {
    season_id: args.seasonId,
    commitment_id: args.commitmentId,
    season_status: args.seasonStatus,
    proof_moment_ids: args.proofMoments.map((m) => m.id),
    proof_category_labels: args.proofMoments.map((m) => getRecentProofCategoryLabel(m)),
    proof_bodies: args.proofMoments.map((m) => m.body.trim()).filter(Boolean),
    proof_moment_count: args.proofMomentCount,
    pat_read_source_hash: args.patReadSourceHash ?? null,
    pat_read_pattern_text: args.patReadPatternText ?? null,
    pat_read_pattern_confidence: args.patReadPatternConfidence ?? "none",
    pat_principles_source_hash: args.patPrinciplesSourceHash ?? null,
    principle_lived_title: args.principleLivedTitle ?? null,
  };
}

type StoredSeasonSummary = {
  summary_text: string | null;
  pattern_text: string | null;
  principle_lived_title: string | null;
  confidence: SeasonSummaryConfidence;
  source_hash: string;
  valid_for_season_key: string;
  input_bundle_json: SeasonSummarySourceBundle;
  reason_for_update: SeasonSummaryUpdateReason;
};

async function fetchPatReadMeta(
  clerkUserId: string,
  commitmentId: string
): Promise<{
  sourceHash: string | null;
  patternText: string | null;
  patternConfidence: PatReadPatternConfidence;
}> {
  const { data, error } = await supabaseServer
    .from("v2_victory_pat_read_snapshot")
    .select("source_hash, pattern_text, pattern_confidence")
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .maybeSingle();

  if (error || !data) {
    return { sourceHash: null, patternText: null, patternConfidence: "none" };
  }

  const conf = data.pattern_confidence as PatReadPatternConfidence;
  const patternConfidence =
    conf === "low" || conf === "medium" || conf === "high" ? conf : "none";
  const patternText =
    data.pattern_text != null && String(data.pattern_text).trim()
      ? String(data.pattern_text)
      : null;

  return {
    sourceHash: String(data.source_hash),
    patternText:
      patternConfidence === "medium" || patternConfidence === "high" ? patternText : null,
    patternConfidence,
  };
}

async function fetchPrinciplesMeta(
  clerkUserId: string,
  commitmentId: string
): Promise<{ sourceHash: string | null; principleLivedTitle: string | null }> {
  const { data, error } = await supabaseServer
    .from("v2_victory_pat_principles_snapshot")
    .select(
      "source_hash, living_well_title, living_well_evidence_ids"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .maybeSingle();

  if (error || !data) {
    return { sourceHash: null, principleLivedTitle: null };
  }

  const evidenceIds = Array.isArray(data.living_well_evidence_ids)
    ? (data.living_well_evidence_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  const title =
    evidenceIds.length > 0 &&
    data.living_well_title != null &&
    String(data.living_well_title).trim()
      ? String(data.living_well_title)
      : null;

  return {
    sourceHash: String(data.source_hash),
    principleLivedTitle: title,
  };
}

async function fetchSeasonSummaryRow(
  clerkUserId: string,
  seasonId: string
): Promise<StoredSeasonSummary | null> {
  const { data, error } = await supabaseServer
    .from("v2_victory_season_summary_snapshot")
    .select(
      "summary_text, pattern_text, principle_lived_title, confidence, source_hash, valid_for_season_key, input_bundle_json, reason_for_update"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("season_id", seasonId)
    .maybeSingle();

  if (error) {
    console.error("[v2-victory-season-summary-persist] snapshot read failed", {
      clerk_user_id: clerkUserId,
      season_id: seasonId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  const bundle = data.input_bundle_json as SeasonSummarySourceBundle;
  return {
    summary_text:
      data.summary_text != null && String(data.summary_text).trim()
        ? String(data.summary_text)
        : null,
    pattern_text:
      data.pattern_text != null && String(data.pattern_text).trim()
        ? String(data.pattern_text)
        : null,
    principle_lived_title:
      data.principle_lived_title != null && String(data.principle_lived_title).trim()
        ? String(data.principle_lived_title)
        : null,
    confidence: data.confidence as SeasonSummaryConfidence,
    source_hash: String(data.source_hash),
    valid_for_season_key: String(data.valid_for_season_key),
    input_bundle_json: bundle,
    reason_for_update: (data.reason_for_update as SeasonSummaryUpdateReason) ?? "initial",
  };
}

function classifyChange(args: {
  existing: StoredSeasonSummary | null;
  newBundle: SeasonSummarySourceBundle;
  newHash: string;
  seasonKey: string;
}): { shouldRefresh: boolean; reason: SeasonSummaryUpdateReason } {
  if (!args.existing) {
    return { shouldRefresh: true, reason: "initial" };
  }
  if (args.existing.source_hash === args.newHash) {
    return { shouldRefresh: false, reason: "source_hash_match" };
  }

  const prev = args.existing.input_bundle_json;
  if (prev.season_status === "active" && isClosedSeason(args.newBundle.season_status)) {
    return { shouldRefresh: true, reason: "season_closed" };
  }

  if (args.existing.valid_for_season_key !== args.seasonKey) {
    return { shouldRefresh: true, reason: "weekly_refresh" };
  }

  if (prev.proof_moment_count === 0 && args.newBundle.proof_moment_count > 0) {
    return { shouldRefresh: true, reason: "first_real_proof" };
  }

  if (prev.pat_read_source_hash !== args.newBundle.pat_read_source_hash) {
    return { shouldRefresh: true, reason: "pat_read_changed" };
  }

  if (prev.pat_principles_source_hash !== args.newBundle.pat_principles_source_hash) {
    return { shouldRefresh: true, reason: "pat_principles_changed" };
  }

  const prevMajor =
    prev.proof_moment_count < args.newBundle.proof_moment_count &&
    args.newBundle.proof_category_labels.some(
      (l) => !prev.proof_category_labels.includes(l)
    );

  if (prevMajor) {
    return { shouldRefresh: true, reason: "major_evidence_change" };
  }

  return { shouldRefresh: false, reason: "source_hash_match" };
}

function rowToDisplay(row: StoredSeasonSummary): SeasonSummaryForDisplay {
  return {
    summaryText: row.summary_text,
    patternText: row.pattern_text,
    principleLivedTitle: row.principle_lived_title,
    confidence: row.confidence,
  };
}

export async function loadSeasonSummaryForDisplay(args: {
  clerkUserId: string;
  seasonId: string;
  commitmentId: string;
  seasonStatus: string;
  proofMoments: VictoryMoment[];
  proofMomentCount: number;
}): Promise<SeasonSummaryForDisplay | null> {
  if (!isClosedSeason(args.seasonStatus)) {
    return null;
  }

  const patRead = await fetchPatReadMeta(args.clerkUserId, args.commitmentId);
  const principles = await fetchPrinciplesMeta(args.clerkUserId, args.commitmentId);

  const bundle = computeSeasonSummarySourceBundle({
    seasonId: args.seasonId,
    commitmentId: args.commitmentId,
    seasonStatus: args.seasonStatus,
    proofMoments: args.proofMoments,
    proofMomentCount: args.proofMomentCount,
    patReadSourceHash: patRead.sourceHash,
    patReadPatternText: patRead.patternText,
    patReadPatternConfidence: patRead.patternConfidence,
    patPrinciplesSourceHash: principles.sourceHash,
    principleLivedTitle: principles.principleLivedTitle,
  });

  const seasonKey = getValidForSeasonKey(args.seasonId, args.seasonStatus);
  const sourceHash = computeSeasonSummarySourceHash(bundle);

  const fallback = (): SeasonSummaryForDisplay => {
    const built = buildDeterministicSeasonSummary({
      seasonStatus: args.seasonStatus,
      proofMoments: args.proofMoments,
      proofMomentCount: args.proofMomentCount,
      patternText: patRead.patternText,
      patternConfidence: patRead.patternConfidence,
      principleLivedTitle: principles.principleLivedTitle,
    });
    return {
      summaryText: built.summaryText,
      patternText: built.patternText,
      principleLivedTitle: built.principleLivedTitle,
      confidence: built.confidence,
    };
  };

  const existing = await fetchSeasonSummaryRow(args.clerkUserId, args.seasonId);
  const classification = classifyChange({
    existing,
    newBundle: bundle,
    newHash: sourceHash,
    seasonKey,
  });

  if (!classification.shouldRefresh) {
    if (existing) return rowToDisplay(existing);
    return fallback();
  }

  const built = buildDeterministicSeasonSummary({
    seasonStatus: args.seasonStatus,
    proofMoments: args.proofMoments,
    proofMomentCount: args.proofMomentCount,
    patternText: patRead.patternText,
    patternConfidence: patRead.patternConfidence,
    principleLivedTitle: principles.principleLivedTitle,
  });

  if (!built.summaryText) {
    return {
      summaryText: null,
      patternText: null,
      principleLivedTitle: null,
      confidence: built.confidence,
    };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseServer.from("v2_victory_season_summary_snapshot").upsert(
    {
      clerk_user_id: args.clerkUserId,
      season_id: args.seasonId,
      commitment_id: args.commitmentId,
      summary_text: built.summaryText,
      strongest_proof_moment_id: built.strongestProofMomentId,
      pattern_text: built.patternText,
      principle_lived_title: built.principleLivedTitle,
      proof_moment_count: args.proofMomentCount,
      confidence: built.confidence,
      source_hash: sourceHash,
      valid_for_season_key: seasonKey,
      input_bundle_json: bundle,
      reason_for_update: classification.reason,
      provenance: "deterministic",
      generated_at: now,
      updated_at: now,
    },
    { onConflict: "clerk_user_id,season_id" }
  );

  if (error) {
    console.error("[v2-victory-season-summary-persist] snapshot upsert failed", {
      clerk_user_id: args.clerkUserId,
      season_id: args.seasonId,
      message: error.message,
    });
    return fallback();
  }

  return {
    summaryText: built.summaryText,
    patternText: built.patternText,
    principleLivedTitle: built.principleLivedTitle,
    confidence: built.confidence,
  };
}

export type SeasonListHintForRoom = {
  hasSavedProof: boolean;
  summary?: SeasonSummaryForDisplay;
};

export async function fetchSeasonListHintsForRoom(
  clerkUserId: string,
  seasonIds: string[]
): Promise<Map<string, SeasonListHintForRoom>> {
  const out = new Map<string, SeasonListHintForRoom>();
  if (seasonIds.length === 0) return out;

  const { data, error } = await supabaseServer
    .from("v2_victory_season_summary_snapshot")
    .select(
      "season_id, summary_text, pattern_text, principle_lived_title, confidence, proof_moment_count"
    )
    .eq("clerk_user_id", clerkUserId)
    .in("season_id", seasonIds);

  if (error) {
    console.error("[v2-victory-season-summary-persist] list hints read failed", {
      message: error.message,
    });
    return out;
  }

  for (const row of data ?? []) {
    if (typeof row.season_id !== "string") continue;
    const confidence = row.confidence as SeasonSummaryConfidence;
    const proofMomentCount =
      typeof row.proof_moment_count === "number" ? row.proof_moment_count : 0;
    const summaryText =
      row.summary_text != null && String(row.summary_text).trim()
        ? String(row.summary_text)
        : null;

    const hasSavedProof =
      proofMomentCount > 0 ||
      (summaryText != null && (confidence === "medium" || confidence === "high"));

    const summary: SeasonSummaryForDisplay | undefined =
      summaryText && (confidence === "medium" || confidence === "high")
        ? {
            summaryText,
            patternText:
              row.pattern_text != null && String(row.pattern_text).trim()
                ? String(row.pattern_text)
                : null,
            principleLivedTitle:
              row.principle_lived_title != null && String(row.principle_lived_title).trim()
                ? String(row.principle_lived_title)
                : null,
            confidence,
          }
        : undefined;

    out.set(row.season_id, { hasSavedProof, summary });
  }

  return out;
}

/** @deprecated Use fetchSeasonListHintsForRoom */
export async function fetchSeasonSummaryTeaserForList(
  clerkUserId: string,
  seasonIds: string[]
): Promise<Map<string, SeasonSummaryForDisplay>> {
  const hints = await fetchSeasonListHintsForRoom(clerkUserId, seasonIds);
  const out = new Map<string, SeasonSummaryForDisplay>();
  for (const [id, hint] of hints) {
    if (hint.summary) out.set(id, hint.summary);
  }
  return out;
}

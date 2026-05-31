import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  computePatReadPatternConfidence,
  computePatReadSourceBundle,
  computePatReadSourceHash,
  stableSerializeForHash,
  type PatReadPatternConfidence,
} from "@/lib/v2-victory-pat-read-persist";
import { buildDeterministicPatRead } from "@/lib/v2-victory-pat-read";
import {
  buildDeterministicPrinciplesFromView,
  buildPrinciplesSnapshotContent,
  snapshotContentToDisplay,
  type PrinciplesSnapshotContent,
  type VictoryPatPrinciplesForDisplay,
} from "@/lib/v2-victory-principles-map";
import {
  getRecentProofCategoryLabel,
  type VictoryRoomViewData,
} from "@/lib/v2-victory-room-view";
import { createHash } from "node:crypto";

export type PrinciplesProvenance = "deterministic" | "ai" | "fallback";

export type PrinciplesUpdateReason =
  | "initial"
  | "source_hash_match"
  | "weekly_refresh"
  | "first_real_proof"
  | "identity_changed"
  | "goal_changed"
  | "season_changed"
  | "pattern_became_confident"
  | "major_evidence_change"
  | "pat_read_changed"
  | "fallback";

export type PatPrinciplesSourceBundle = {
  commitment_id: string;
  season_id: string | null;
  identity_anchor_text: string | null;
  commitment_title: string | null;
  behavior_statement: string | null;
  effective_coaching_ask: string | null;
  sparse: boolean;
  is_day_zero: boolean;
  pattern_confidence: PatReadPatternConfidence;
  evidence_counts: {
    kept_the_goal: number;
    told_the_truth: number;
    got_back_on_track: number;
    adjusted_wisely: number;
    raised_the_bar: number;
    seasons_completed: number;
  };
  recent_proof_moment_ids: string[];
  recent_proof_category_labels: string[];
  recent_proof_bodies: string[];
  comeback_lines: string[];
  pat_read_source_hash: string | null;
  week_key: string;
};

export type PrinciplesSourceChangeClassification = {
  shouldRefresh: boolean;
  reasonForUpdate: PrinciplesUpdateReason;
};

type StoredPrinciplesSnapshot = {
  living_well_principle_id: string | null;
  living_well_title: string | null;
  living_well_text: string | null;
  living_well_evidence_ids: string[];
  focus_next_principle_id: string;
  focus_next_title: string;
  focus_next_text: string;
  focus_next_evidence_ids: string[];
  starter_text: string | null;
  confidence: PrinciplesSnapshotContent["confidence"];
  provenance: PrinciplesProvenance;
  source_hash: string;
  valid_for_week_key: string;
  input_bundle_json: PatPrinciplesSourceBundle;
  reason_for_update: PrinciplesUpdateReason;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function computePrinciplesSourceHash(bundle: PatPrinciplesSourceBundle): string {
  return createHash("sha256").update(stableSerializeForHash(bundle)).digest("hex");
}

/** ISO week key in user timezone, e.g. 2026-W21:America/New_York */
export function getPrinciplesWeekKey(timezoneRaw: unknown): string {
  const timezone = resolveUserTimezone(timezoneRaw);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const local = new Date(Date.UTC(y, m - 1, d));
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((local.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${local.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}:${timezone}`;
}

function bundleWasSparse(bundle: PatPrinciplesSourceBundle | null | undefined): boolean {
  if (!bundle || typeof bundle !== "object") return true;
  return bundle.sparse === true || bundle.recent_proof_moment_ids.length === 0;
}

function bundleHasRealProof(bundle: PatPrinciplesSourceBundle): boolean {
  return (
    bundle.recent_proof_moment_ids.length > 0 ||
    bundle.comeback_lines.length > 0 ||
    bundle.evidence_counts.seasons_completed > 0
  );
}

function isLowPatternConfidence(confidence: PatReadPatternConfidence): boolean {
  return confidence === "none" || confidence === "low";
}

function isShowablePatternConfidence(confidence: PatReadPatternConfidence): boolean {
  return confidence === "medium" || confidence === "high";
}

function detectMajorEvidenceChange(
  previous: PatPrinciplesSourceBundle,
  next: PatPrinciplesSourceBundle
): boolean {
  const prev = previous.evidence_counts;
  const nxt = next.evidence_counts;

  if (prev.got_back_on_track === 0 && nxt.got_back_on_track > 0) return true;
  if (prev.adjusted_wisely === 0 && nxt.adjusted_wisely > 0) return true;
  if (prev.raised_the_bar === 0 && nxt.raised_the_bar > 0) return true;
  if (prev.seasons_completed === 0 && nxt.seasons_completed > 0) return true;

  return false;
}

/** Curated proof inputs that affect principle selection/copy (not evidence-count-only bumps). */
function detectPrincipleRelevantInputChange(
  previous: PatPrinciplesSourceBundle,
  next: PatPrinciplesSourceBundle
): boolean {
  if (
    stableSerializeForHash(previous.recent_proof_moment_ids) !==
    stableSerializeForHash(next.recent_proof_moment_ids)
  ) {
    return true;
  }
  if (
    stableSerializeForHash(previous.recent_proof_bodies) !==
    stableSerializeForHash(next.recent_proof_bodies)
  ) {
    return true;
  }
  if (
    stableSerializeForHash(previous.recent_proof_category_labels) !==
    stableSerializeForHash(next.recent_proof_category_labels)
  ) {
    return true;
  }
  if (
    stableSerializeForHash(previous.comeback_lines) !== stableSerializeForHash(next.comeback_lines)
  ) {
    return true;
  }
  return false;
}

function detectSameWeekMajorChange(args: {
  previousBundle: PatPrinciplesSourceBundle;
  nextBundle: PatPrinciplesSourceBundle;
}): PrinciplesUpdateReason | null {
  if (
    normalizeText(args.previousBundle.identity_anchor_text) !==
    normalizeText(args.nextBundle.identity_anchor_text)
  ) {
    return "identity_changed";
  }

  if (args.previousBundle.commitment_id !== args.nextBundle.commitment_id) {
    return "goal_changed";
  }
  if (
    normalizeText(args.previousBundle.commitment_title) !==
    normalizeText(args.nextBundle.commitment_title)
  ) {
    return "goal_changed";
  }
  if (
    normalizeText(args.previousBundle.behavior_statement) !==
    normalizeText(args.nextBundle.behavior_statement)
  ) {
    return "goal_changed";
  }
  if (
    normalizeText(args.previousBundle.effective_coaching_ask) !==
    normalizeText(args.nextBundle.effective_coaching_ask)
  ) {
    return "goal_changed";
  }

  if (args.previousBundle.season_id !== args.nextBundle.season_id) {
    return "season_changed";
  }

  if (bundleWasSparse(args.previousBundle) && bundleHasRealProof(args.nextBundle)) {
    return "first_real_proof";
  }

  const prevConf = args.previousBundle.pattern_confidence;
  const nextConf = args.nextBundle.pattern_confidence;
  if (isLowPatternConfidence(prevConf) && isShowablePatternConfidence(nextConf)) {
    return "pattern_became_confident";
  }

  if (detectMajorEvidenceChange(args.previousBundle, args.nextBundle)) {
    return "major_evidence_change";
  }

  if (detectPrincipleRelevantInputChange(args.previousBundle, args.nextBundle)) {
    return "pat_read_changed";
  }

  return null;
}

export function classifyPrinciplesSourceChange(args: {
  existing: StoredPrinciplesSnapshot | null;
  newBundle: PatPrinciplesSourceBundle;
  newHash: string;
  currentWeekKey: string;
}): PrinciplesSourceChangeClassification {
  if (!args.existing) {
    return { shouldRefresh: true, reasonForUpdate: "initial" };
  }

  if (args.existing.source_hash === args.newHash) {
    return { shouldRefresh: false, reasonForUpdate: "source_hash_match" };
  }

  const previousBundle = normalizeStoredPrinciplesBundle(args.existing.input_bundle_json);
  if (!previousBundle) {
    return { shouldRefresh: true, reasonForUpdate: "initial" };
  }

  if (args.existing.valid_for_week_key !== args.currentWeekKey) {
    return { shouldRefresh: true, reasonForUpdate: "weekly_refresh" };
  }

  const majorReason = detectSameWeekMajorChange({
    previousBundle,
    nextBundle: args.newBundle,
  });

  if (majorReason) {
    return { shouldRefresh: true, reasonForUpdate: majorReason };
  }

  return { shouldRefresh: false, reasonForUpdate: "source_hash_match" };
}

export function normalizeStoredPrinciplesBundle(
  raw: unknown
): PatPrinciplesSourceBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<PatPrinciplesSourceBundle>;
  if (typeof b.commitment_id !== "string" || !b.commitment_id.trim()) {
    return null;
  }

  const counts = b.evidence_counts ?? {
    kept_the_goal: 0,
    told_the_truth: 0,
    got_back_on_track: 0,
    adjusted_wisely: 0,
    raised_the_bar: 0,
    seasons_completed: 0,
  };

  return {
    commitment_id: b.commitment_id,
    season_id: typeof b.season_id === "string" ? b.season_id : null,
    identity_anchor_text:
      typeof b.identity_anchor_text === "string" ? b.identity_anchor_text : null,
    commitment_title: typeof b.commitment_title === "string" ? b.commitment_title : null,
    behavior_statement:
      typeof b.behavior_statement === "string" ? b.behavior_statement : null,
    effective_coaching_ask:
      typeof b.effective_coaching_ask === "string" ? b.effective_coaching_ask : null,
    sparse: b.sparse === true,
    is_day_zero: b.is_day_zero === true,
    pattern_confidence:
      b.pattern_confidence === "low" ||
      b.pattern_confidence === "medium" ||
      b.pattern_confidence === "high"
        ? b.pattern_confidence
        : "none",
    evidence_counts: {
      kept_the_goal: counts.kept_the_goal ?? 0,
      told_the_truth: counts.told_the_truth ?? 0,
      got_back_on_track: counts.got_back_on_track ?? 0,
      adjusted_wisely: counts.adjusted_wisely ?? 0,
      raised_the_bar: counts.raised_the_bar ?? 0,
      seasons_completed: counts.seasons_completed ?? 0,
    },
    recent_proof_moment_ids: Array.isArray(b.recent_proof_moment_ids)
      ? b.recent_proof_moment_ids.filter((id): id is string => typeof id === "string")
      : [],
    recent_proof_category_labels: Array.isArray(b.recent_proof_category_labels)
      ? b.recent_proof_category_labels.filter((l): l is string => typeof l === "string")
      : [],
    recent_proof_bodies: Array.isArray(b.recent_proof_bodies)
      ? b.recent_proof_bodies.filter((l): l is string => typeof l === "string")
      : [],
    comeback_lines: Array.isArray(b.comeback_lines)
      ? b.comeback_lines.filter((l): l is string => typeof l === "string")
      : [],
    pat_read_source_hash:
      typeof b.pat_read_source_hash === "string" ? b.pat_read_source_hash : null,
    week_key: typeof b.week_key === "string" ? b.week_key : "",
  };
}

export function computePrinciplesSourceBundle(
  view: VictoryRoomViewData,
  options?: {
    seasonId?: string | null;
    weekKey?: string;
    patReadSourceHash?: string | null;
  }
): PatPrinciplesSourceBundle | null {
  if (!view.commitment?.id) {
    return null;
  }

  const patReadBundle = computePatReadSourceBundle(view, {
    seasonId: options?.seasonId,
  });
  const patReadHash =
    options?.patReadSourceHash ??
    (patReadBundle ? computePatReadSourceHash(patReadBundle) : null);

  const deterministic = buildDeterministicPatRead(view, "there");
  const patternConfidence = computePatReadPatternConfidence(
    view,
    deterministic?.pattern ?? null
  );

  return {
    commitment_id: view.commitment.id,
    season_id: options?.seasonId ?? null,
    identity_anchor_text: view.profile.identity_anchor_text?.trim() || null,
    commitment_title: view.commitment.title?.trim() || null,
    behavior_statement: view.commitment.behavior_statement?.trim() || null,
    effective_coaching_ask: view.effectiveCoachingAsk?.trim() || null,
    sparse: view.hasSparseProof,
    is_day_zero: view.isDayZeroUser,
    pattern_confidence: patternConfidence,
    evidence_counts: {
      kept_the_goal: view.evidenceCounts.keptTheGoal,
      told_the_truth: view.evidenceCounts.toldTheTruth,
      got_back_on_track: view.evidenceCounts.gotBackOnTrack,
      adjusted_wisely: view.evidenceCounts.adjustedWisely,
      raised_the_bar: view.evidenceCounts.raisedTheBar,
      seasons_completed: view.evidenceCounts.seasonsCompleted,
    },
    recent_proof_moment_ids: view.moments.map((m) => m.id),
    recent_proof_category_labels: view.moments.map((m) => getRecentProofCategoryLabel(m)),
    recent_proof_bodies: view.moments.map((m) => m.body.trim()).filter(Boolean),
    comeback_lines: view.comebackLines.map((l) => l.trim()).filter(Boolean),
    pat_read_source_hash: patReadHash,
    week_key: options?.weekKey ?? "",
  };
}

export function buildDeterministicPrinciplesSnapshot(args: {
  view: VictoryRoomViewData;
  sourceHash: string;
  weekKey: string;
  seasonId?: string | null;
  reasonForUpdate: PrinciplesUpdateReason;
  patReadSourceHash?: string | null;
}): {
  snapshot: PrinciplesSnapshotContent & {
    provenance: PrinciplesProvenance;
    source_hash: string;
    valid_for_week_key: string;
    input_bundle_json: PatPrinciplesSourceBundle;
    reason_for_update: PrinciplesUpdateReason;
  };
} | null {
  const bundle = computePrinciplesSourceBundle(args.view, {
    seasonId: args.seasonId,
    weekKey: args.weekKey,
    patReadSourceHash: args.patReadSourceHash,
  });
  if (!bundle) return null;

  const content = buildPrinciplesSnapshotContent(args.view, {
    patternConfidence: bundle.pattern_confidence,
  });

  return {
    snapshot: {
      ...content,
      provenance: "deterministic",
      source_hash: args.sourceHash,
      valid_for_week_key: args.weekKey,
      input_bundle_json: bundle,
      reason_for_update: args.reasonForUpdate,
    },
  };
}

async function loadActiveSeasonId(clerkUserId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("user_accountability_season")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[v2-victory-principles-persist] active season load failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

async function fetchPrinciplesSnapshot(
  clerkUserId: string,
  commitmentId: string
): Promise<StoredPrinciplesSnapshot | null> {
  const { data, error } = await supabaseServer
    .from("v2_victory_pat_principles_snapshot")
    .select(
      "living_well_principle_id, living_well_title, living_well_text, living_well_evidence_ids, focus_next_principle_id, focus_next_title, focus_next_text, focus_next_evidence_ids, starter_text, confidence, provenance, source_hash, valid_for_week_key, input_bundle_json, reason_for_update"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .maybeSingle();

  if (error) {
    console.error("[v2-victory-principles-persist] snapshot read failed", {
      clerk_user_id: clerkUserId,
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  const bundle = normalizeStoredPrinciplesBundle(data.input_bundle_json);
  if (!bundle) return null;

  const livingIds = Array.isArray(data.living_well_evidence_ids)
    ? (data.living_well_evidence_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const focusIds = Array.isArray(data.focus_next_evidence_ids)
    ? (data.focus_next_evidence_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  return {
    living_well_principle_id:
      data.living_well_principle_id != null ? String(data.living_well_principle_id) : null,
    living_well_title:
      data.living_well_title != null ? String(data.living_well_title) : null,
    living_well_text:
      data.living_well_text != null ? String(data.living_well_text) : null,
    living_well_evidence_ids: livingIds,
    focus_next_principle_id: String(data.focus_next_principle_id),
    focus_next_title: String(data.focus_next_title),
    focus_next_text: String(data.focus_next_text),
    focus_next_evidence_ids: focusIds,
    starter_text: data.starter_text != null ? String(data.starter_text) : null,
    confidence: data.confidence as PrinciplesSnapshotContent["confidence"],
    provenance: data.provenance as PrinciplesProvenance,
    source_hash: String(data.source_hash),
    valid_for_week_key: String(data.valid_for_week_key),
    input_bundle_json: bundle,
    reason_for_update: (data.reason_for_update as PrinciplesUpdateReason) ?? "initial",
  };
}

async function upsertPrinciplesSnapshot(args: {
  clerkUserId: string;
  commitmentId: string;
  seasonId: string | null;
  snapshot: StoredPrinciplesSnapshot & {
    reason_for_update: PrinciplesUpdateReason;
  };
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await supabaseServer.from("v2_victory_pat_principles_snapshot").upsert(
    {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      season_id: args.seasonId,
      living_well_principle_id: args.snapshot.living_well_principle_id,
      living_well_title: args.snapshot.living_well_title,
      living_well_text: args.snapshot.living_well_text,
      living_well_evidence_ids: args.snapshot.living_well_evidence_ids,
      focus_next_principle_id: args.snapshot.focus_next_principle_id,
      focus_next_title: args.snapshot.focus_next_title,
      focus_next_text: args.snapshot.focus_next_text,
      focus_next_evidence_ids: args.snapshot.focus_next_evidence_ids,
      starter_text: args.snapshot.starter_text,
      confidence: args.snapshot.confidence,
      provenance: args.snapshot.provenance,
      source_hash: args.snapshot.source_hash,
      valid_for_week_key: args.snapshot.valid_for_week_key,
      input_bundle_json: args.snapshot.input_bundle_json,
      reason_for_update: args.snapshot.reason_for_update,
      generated_at: now,
      updated_at: now,
    },
    { onConflict: "clerk_user_id,commitment_id" }
  );

  if (error) {
    console.error("[v2-victory-principles-persist] snapshot upsert failed", {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return false;
  }

  return true;
}

function rowToDisplay(row: StoredPrinciplesSnapshot): VictoryPatPrinciplesForDisplay {
  const livingWell =
    row.living_well_text &&
    row.living_well_title &&
    row.living_well_evidence_ids.length > 0
      ? {
          title: row.living_well_title,
          text: row.living_well_text,
          evidenceIds: row.living_well_evidence_ids,
        }
      : null;

  return {
    confidence: row.confidence,
    starterText: row.starter_text,
    livingWell,
    focusNext: {
      title: row.focus_next_title,
      text: row.focus_next_text,
      evidenceIds: row.focus_next_evidence_ids,
    },
    updatedFromProof: row.confidence !== "starter",
  };
}

export async function loadPatPrinciplesForVictoryRoom(args: {
  clerkUserId: string;
  view: VictoryRoomViewData;
  timezone?: unknown;
  patReadSourceHash?: string | null;
}): Promise<VictoryPatPrinciplesForDisplay | null> {
  if (!args.view.hasActiveV2Commitment || !args.view.commitment?.id) {
    return null;
  }

  const commitmentId = args.view.commitment.id;
  const weekKey = getPrinciplesWeekKey(args.timezone);
  const seasonId = await loadActiveSeasonId(args.clerkUserId);

  const patReadBundle = computePatReadSourceBundle(args.view, { seasonId });
  const patReadHash =
    args.patReadSourceHash ??
    (patReadBundle ? computePatReadSourceHash(patReadBundle) : null);

  const bundle = computePrinciplesSourceBundle(args.view, {
    seasonId,
    weekKey,
    patReadSourceHash: patReadHash,
  });

  const fallback = (): VictoryPatPrinciplesForDisplay =>
    buildDeterministicPrinciplesFromView(args.view, {
      patternConfidence: bundle?.pattern_confidence,
    });

  if (!bundle) {
    return fallback();
  }

  const sourceHash = computePrinciplesSourceHash(bundle);
  const existing = await fetchPrinciplesSnapshot(args.clerkUserId, commitmentId);

  const classification = classifyPrinciplesSourceChange({
    existing,
    newBundle: bundle,
    newHash: sourceHash,
    currentWeekKey: weekKey,
  });

  if (!classification.shouldRefresh) {
    if (existing) {
      return rowToDisplay(existing);
    }
    return fallback();
  }

  const built = buildDeterministicPrinciplesSnapshot({
    view: args.view,
    sourceHash,
    weekKey,
    seasonId,
    reasonForUpdate: classification.reasonForUpdate,
    patReadSourceHash: patReadHash,
  });

  if (!built) {
    return fallback();
  }

  const persisted = await upsertPrinciplesSnapshot({
    clerkUserId: args.clerkUserId,
    commitmentId,
    seasonId,
    snapshot: built.snapshot,
  });

  if (!persisted) {
    return fallback();
  }

  return snapshotContentToDisplay(built.snapshot);
}

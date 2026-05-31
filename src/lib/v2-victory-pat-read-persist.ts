import "server-only";

import { createHash } from "node:crypto";

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  buildDeterministicPatRead,
  buildVictorySummaryInput,
} from "@/lib/v2-victory-pat-read";
import {
  getRecentProofCategoryLabel,
  inferRecentProofCategory,
  type VictoryMoment,
  type VictoryRoomViewData,
} from "@/lib/v2-victory-room-view";

export type PatReadProvenance = "deterministic" | "ai" | "fallback";

export type PatReadPatternConfidence = "none" | "low" | "medium" | "high";

export type PatReadUpdateReason =
  | "initial"
  | "source_hash_match"
  | "daily_refresh"
  | "first_real_proof"
  | "identity_changed"
  | "goal_changed"
  | "season_changed"
  | "pattern_became_confident"
  | "major_evidence_change"
  | "fallback";

/** User-facing Coach Pat's Read (no internal metadata). */
export type VictoryPatReadForDisplay = {
  strength: string;
  pattern: string | null;
  nextMove: string;
};

export type PatReadSourceBundle = {
  commitment_id: string;
  season_id: string | null;
  season_name: string | null;
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
  proof_moments: Array<{
    id: string;
    body: string;
    category_label: string;
  }>;
  comeback_lines: string[];
  latest_proof_moment_id: string | null;
};

export type PatReadSourceChangeClassification = {
  shouldRefresh: boolean;
  reasonForUpdate: PatReadUpdateReason;
};

type PatReadSnapshotRow = {
  strength_text: string;
  pattern_text: string | null;
  next_move_text: string;
  provenance: PatReadProvenance;
  source_hash: string;
  valid_for_day_key: string;
  input_bundle_json: PatReadSourceBundle;
  pattern_confidence: PatReadPatternConfidence;
  reason_for_update: PatReadUpdateReason;
  linked_proof_moment_ids: string[];
};

type StoredPatReadSnapshot = {
  strength_text: string;
  pattern_text: string | null;
  next_move_text: string;
  provenance: PatReadProvenance;
  source_hash: string;
  valid_for_day_key: string;
  input_bundle_json: PatReadSourceBundle;
  pattern_confidence: PatReadPatternConfidence;
  reason_for_update: PatReadUpdateReason;
};

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

export function stableSerializeForHash(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function computePatReadSourceHash(bundle: PatReadSourceBundle): string {
  return createHash("sha256").update(stableSerializeForHash(bundle)).digest("hex");
}

export function getPatReadDayKey(timezoneRaw: unknown): string {
  const timezone = resolveUserTimezone(timezoneRaw);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `${date}:${timezone}`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function bundleWasSparse(bundle: PatReadSourceBundle | null | undefined): boolean {
  if (!bundle || typeof bundle !== "object") return true;
  return bundle.sparse === true || (bundle.proof_moments?.length ?? 0) === 0;
}

function bundleHasRealProof(bundle: PatReadSourceBundle): boolean {
  return bundle.proof_moments.length > 0 || bundle.comeback_lines.length > 0;
}

function isLowPatternConfidence(confidence: PatReadPatternConfidence): boolean {
  return confidence === "none" || confidence === "low";
}

function isShowablePatternConfidence(confidence: PatReadPatternConfidence): boolean {
  return confidence === "medium" || confidence === "high";
}

export function normalizeStoredPatReadBundle(raw: unknown): PatReadSourceBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<PatReadSourceBundle>;
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
    season_name: typeof b.season_name === "string" ? b.season_name : null,
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
    proof_moments: Array.isArray(b.proof_moments)
      ? b.proof_moments
          .filter(
            (m): m is PatReadSourceBundle["proof_moments"][number] =>
              typeof m === "object" &&
              m != null &&
              typeof (m as { id?: unknown }).id === "string" &&
              typeof (m as { body?: unknown }).body === "string" &&
              typeof (m as { category_label?: unknown }).category_label === "string"
          )
          .map((m) => ({
            id: m.id,
            body: m.body,
            category_label: m.category_label,
          }))
      : [],
    comeback_lines: Array.isArray(b.comeback_lines)
      ? b.comeback_lines.filter((l): l is string => typeof l === "string")
      : [],
    latest_proof_moment_id:
      typeof b.latest_proof_moment_id === "string" ? b.latest_proof_moment_id : null,
  };
}

function proofMomentsSignature(moments: PatReadSourceBundle["proof_moments"]): string {
  return moments.map((m) => `${m.id}\u0000${m.body}`).join("\u0001");
}

function comebackLinesSignature(lines: string[] | undefined): string {
  return (lines ?? []).join("\u0001");
}

/** Curated proof / comeback / pattern inputs that should refresh Coach Pat copy (same day). */
export function detectMeaningfulCuratedProofChange(
  previous: PatReadSourceBundle,
  next: PatReadSourceBundle
): boolean {
  if (previous.latest_proof_moment_id !== next.latest_proof_moment_id) {
    return true;
  }
  if (proofMomentsSignature(previous.proof_moments) !== proofMomentsSignature(next.proof_moments)) {
    return true;
  }
  if (comebackLinesSignature(previous.comeback_lines) !== comebackLinesSignature(next.comeback_lines)) {
    return true;
  }
  if (previous.pattern_confidence !== next.pattern_confidence) {
    return true;
  }
  return false;
}

function detectMajorEvidenceChange(
  previous: PatReadSourceBundle,
  next: PatReadSourceBundle
): boolean {
  const prev = previous.evidence_counts;
  const nxt = next.evidence_counts;

  if (prev.got_back_on_track === 0 && nxt.got_back_on_track > 0) return true;
  if (prev.adjusted_wisely === 0 && nxt.adjusted_wisely > 0) return true;
  if (prev.raised_the_bar === 0 && nxt.raised_the_bar > 0) return true;
  if (prev.seasons_completed === 0 && nxt.seasons_completed > 0) return true;

  return false;
}

function detectSameDayMajorChange(args: {
  previousBundle: PatReadSourceBundle;
  nextBundle: PatReadSourceBundle;
  previousPatternConfidence: PatReadPatternConfidence;
  nextPatternConfidence: PatReadPatternConfidence;
}): PatReadUpdateReason | null {
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
  if (
    normalizeText(args.previousBundle.season_name) !==
    normalizeText(args.nextBundle.season_name)
  ) {
    return "season_changed";
  }

  if (bundleWasSparse(args.previousBundle) && bundleHasRealProof(args.nextBundle)) {
    return "first_real_proof";
  }

  if (
    isLowPatternConfidence(args.previousPatternConfidence) &&
    isShowablePatternConfidence(args.nextPatternConfidence)
  ) {
    return "pattern_became_confident";
  }

  if (detectMajorEvidenceChange(args.previousBundle, args.nextBundle)) {
    return "major_evidence_change";
  }

  if (detectMeaningfulCuratedProofChange(args.previousBundle, args.nextBundle)) {
    return "major_evidence_change";
  }

  return null;
}

export function classifyPatReadSourceChange(args: {
  existing: StoredPatReadSnapshot | null;
  newBundle: PatReadSourceBundle;
  newHash: string;
  todayDayKey: string;
}): PatReadSourceChangeClassification {
  if (!args.existing) {
    return { shouldRefresh: true, reasonForUpdate: "initial" };
  }

  if (args.existing.source_hash === args.newHash) {
    return { shouldRefresh: false, reasonForUpdate: "source_hash_match" };
  }

  const previousBundle = normalizeStoredPatReadBundle(args.existing.input_bundle_json);
  if (!previousBundle) {
    return { shouldRefresh: true, reasonForUpdate: "initial" };
  }

  if (args.existing.valid_for_day_key !== args.todayDayKey) {
    return { shouldRefresh: true, reasonForUpdate: "daily_refresh" };
  }

  const majorReason = detectSameDayMajorChange({
    previousBundle,
    nextBundle: args.newBundle,
    previousPatternConfidence: previousBundle.pattern_confidence,
    nextPatternConfidence: args.newBundle.pattern_confidence,
  });

  if (majorReason) {
    return { shouldRefresh: true, reasonForUpdate: majorReason };
  }

  return { shouldRefresh: false, reasonForUpdate: "source_hash_match" };
}

export function computePatReadSourceBundle(
  view: VictoryRoomViewData,
  options?: { seasonId?: string | null }
): PatReadSourceBundle | null {
  if (!view.commitment?.id) {
    return null;
  }

  const proofMoments = view.moments.map((m) => ({
    id: m.id,
    body: m.body.trim(),
    category_label: getRecentProofCategoryLabel(m),
  }));

  const latest = [...view.moments].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )[0];

  const deterministic = buildDeterministicPatRead(view, "there");
  const patternConfidence = computePatReadPatternConfidence(
    view,
    deterministic?.pattern ?? null
  );

  return {
    commitment_id: view.commitment.id,
    season_id: options?.seasonId ?? null,
    season_name: view.activeSeason?.season_name?.trim() || null,
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
    proof_moments: proofMoments,
    comeback_lines: view.comebackLines.map((l) => l.trim()).filter(Boolean),
    latest_proof_moment_id: latest?.id ?? null,
  };
}

export function computePatReadPatternConfidence(
  view: VictoryRoomViewData,
  deterministicPattern: string | null
): PatReadPatternConfidence {
  const input = buildVictorySummaryInput(view, "there");
  if (!input || input.sparse || input.moments.length < 2) {
    return "none";
  }

  if (!deterministicPattern) {
    return "low";
  }

  const cats = input.moments.map((m) => {
    const full: VictoryMoment = {
      id: "pat-read-confidence",
      occurredAt: new Date(0).toISOString(),
      headline: m.headline,
      body: m.body,
      groundedInEventTypes: [],
    };
    return inferRecentProofCategory(full);
  });

  const first = cats[0];
  const sameCategoryCount =
    first != null ? cats.filter((c) => c === first).length : 0;

  if (sameCategoryCount >= 3) {
    return "high";
  }

  return "medium";
}

export function buildPatReadSnapshotFromView(args: {
  view: VictoryRoomViewData;
  displayName: string;
  sourceHash: string;
  dayKey: string;
  seasonId?: string | null;
  reasonForUpdate: PatReadUpdateReason;
}): PatReadSnapshotRow | null {
  const bundle = computePatReadSourceBundle(args.view, { seasonId: args.seasonId });
  if (!bundle) {
    return null;
  }

  const deterministic = buildDeterministicPatRead(args.view, args.displayName);
  if (!deterministic) {
    return null;
  }

  const patternConfidence = bundle.pattern_confidence;
  const patternText = isShowablePatternConfidence(patternConfidence)
    ? deterministic.pattern
    : null;

  return {
    strength_text: deterministic.strength,
    pattern_text: patternText,
    next_move_text: deterministic.nextMove,
    provenance: "deterministic",
    source_hash: args.sourceHash,
    valid_for_day_key: args.dayKey,
    input_bundle_json: bundle,
    pattern_confidence: patternConfidence,
    reason_for_update: args.reasonForUpdate,
    linked_proof_moment_ids: bundle.proof_moments.map((m) => m.id),
  };
}

function rowToDisplay(row: {
  strength_text: string;
  pattern_text: string | null;
  next_move_text: string;
}): VictoryPatReadForDisplay {
  return {
    strength: row.strength_text,
    pattern: row.pattern_text,
    nextMove: row.next_move_text,
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
    console.error("[v2-victory-pat-read-persist] active season load failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

async function fetchPatReadSnapshot(
  clerkUserId: string,
  commitmentId: string
): Promise<StoredPatReadSnapshot | null> {
  const { data, error } = await supabaseServer
    .from("v2_victory_pat_read_snapshot")
    .select(
      "strength_text, pattern_text, next_move_text, provenance, source_hash, valid_for_day_key, input_bundle_json, pattern_confidence, reason_for_update"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .maybeSingle();

  if (error) {
    console.error("[v2-victory-pat-read-persist] snapshot read failed", {
      clerk_user_id: clerkUserId,
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;

  const bundle = normalizeStoredPatReadBundle(data.input_bundle_json);
  if (!bundle) {
    return null;
  }

  return {
    strength_text: String(data.strength_text),
    pattern_text:
      data.pattern_text != null && String(data.pattern_text).trim()
        ? String(data.pattern_text)
        : null,
    next_move_text: String(data.next_move_text),
    provenance: data.provenance as PatReadProvenance,
    source_hash: String(data.source_hash),
    valid_for_day_key: String(data.valid_for_day_key),
    input_bundle_json: bundle,
    pattern_confidence: data.pattern_confidence as PatReadPatternConfidence,
    reason_for_update: (data.reason_for_update as PatReadUpdateReason) ?? "initial",
  };
}

async function upsertPatReadSnapshot(args: {
  clerkUserId: string;
  commitmentId: string;
  seasonId: string | null;
  snapshot: PatReadSnapshotRow;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await supabaseServer.from("v2_victory_pat_read_snapshot").upsert(
    {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      season_id: args.seasonId,
      strength_text: args.snapshot.strength_text,
      pattern_text: args.snapshot.pattern_text,
      next_move_text: args.snapshot.next_move_text,
      provenance: args.snapshot.provenance,
      source_hash: args.snapshot.source_hash,
      valid_for_day_key: args.snapshot.valid_for_day_key,
      input_bundle_json: args.snapshot.input_bundle_json,
      pattern_confidence: args.snapshot.pattern_confidence,
      reason_for_update: args.snapshot.reason_for_update,
      linked_proof_moment_ids: args.snapshot.linked_proof_moment_ids,
      generated_at: now,
      updated_at: now,
    },
    { onConflict: "clerk_user_id,commitment_id" }
  );

  if (error) {
    console.error("[v2-victory-pat-read-persist] snapshot upsert failed", {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return false;
  }

  return true;
}

export async function loadPatReadForVictoryRoom(args: {
  clerkUserId: string;
  view: VictoryRoomViewData;
  displayName: string;
  timezone?: unknown;
}): Promise<VictoryPatReadForDisplay | null> {
  if (!args.view.hasActiveV2Commitment || !args.view.commitment?.id) {
    return null;
  }

  const commitmentId = args.view.commitment.id;
  const dayKey = getPatReadDayKey(args.timezone);
  const seasonId = await loadActiveSeasonId(args.clerkUserId);
  const bundle = computePatReadSourceBundle(args.view, { seasonId });
  if (!bundle) {
    const deterministic = buildDeterministicPatRead(args.view, args.displayName);
    return deterministic
      ? {
          strength: deterministic.strength,
          pattern: deterministic.pattern,
          nextMove: deterministic.nextMove,
        }
      : null;
  }

  const sourceHash = computePatReadSourceHash(bundle);
  const fallbackRead = (): VictoryPatReadForDisplay | null => {
    const deterministic = buildDeterministicPatRead(args.view, args.displayName);
    if (!deterministic) return null;
    const pattern =
      isShowablePatternConfidence(bundle.pattern_confidence) && deterministic.pattern
        ? deterministic.pattern
        : null;
    return {
      strength: deterministic.strength,
      pattern,
      nextMove: deterministic.nextMove,
    };
  };

  const existing = await fetchPatReadSnapshot(args.clerkUserId, commitmentId);

  const classification = classifyPatReadSourceChange({
    existing,
    newBundle: bundle,
    newHash: sourceHash,
    todayDayKey: dayKey,
  });

  if (!classification.shouldRefresh) {
    if (existing) {
      return rowToDisplay(existing);
    }
    return fallbackRead();
  }

  const snapshot = buildPatReadSnapshotFromView({
    view: args.view,
    displayName: args.displayName,
    sourceHash,
    dayKey,
    seasonId,
    reasonForUpdate: classification.reasonForUpdate,
  });

  if (!snapshot) {
    return fallbackRead();
  }

  const persisted = await upsertPatReadSnapshot({
    clerkUserId: args.clerkUserId,
    commitmentId,
    seasonId,
    snapshot,
  });

  if (!persisted) {
    return fallbackRead();
  }

  return rowToDisplay(snapshot);
}

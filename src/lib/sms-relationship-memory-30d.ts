/**
 * Relationship Packet v1.8 — structured 30-day / season evidence-backed memory (read-only, no schema).
 */

import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import { normalizeSmsPatternSignalText } from "@/lib/sms-pattern-signal";
import { computeRelationshipSignals } from "@/lib/v2-sms-relationship-profile";
import type { V3VictoryBackgroundFacts } from "@/lib/sms-victory-background-context";

export const RELATIONSHIP_MEMORY_30D_WINDOW_DAYS = 30;
export const RELATIONSHIP_MEMORY_30D_WINDOW_MS =
  RELATIONSHIP_MEMORY_30D_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_MEMORY_30D_SECTION_CHAR_BUDGET = 1_100;
export const MAX_MEMORY_30D_ITEMS_PER_CATEGORY = 2;
export const MAX_MEMORY_30D_PROOF_ITEMS = 3;
export const MIN_RECURRING_BLOCKER_EVIDENCE_COUNT = 2;
export const MAX_MEMORY_30D_EVIDENCE_CHARS = 120;

export type RecurringBlocker30dExample = {
  evidence: string;
  at: string;
  source: string;
  message_sid: string | null;
  commitment_id: string;
  is_exact_body: boolean;
};

export type RecurringBlocker30d = {
  canonical: string;
  evidence_count: number;
  examples: RecurringBlocker30dExample[];
  last_seen_at: string;
  confidence: "low" | "medium" | "high";
  commitment_id: string;
};

export type Proof30d = {
  summary: string;
  proof_type: string;
  evidence: string;
  at: string;
  source: string;
  message_sid: string | null;
  commitment_id: string;
  is_exact_body: false;
};

export type Adjustment30d = {
  kind: string;
  summary: string;
  evidence: string;
  at: string;
  source: string;
  message_sid: string | null;
  commitment_id: string;
  is_exact_body: boolean;
};

export type GoalChange30d = {
  kind: string;
  summary: string;
  evidence: string;
  at: string;
  source: string;
  message_sid: string | null;
  commitment_id: string;
  is_exact_body: false;
};

export type Comeback30d = {
  summary: string;
  evidence: string;
  at: string;
  source: string;
  message_sid: string | null;
  commitment_id: string;
  is_exact_body: false;
};

export type VoicePreference30d = {
  directness_band: string;
  message_density_tolerance: string;
  comeback_sensitivity: string;
  simplification_bias: string;
  evidence: string;
  source: string;
  updated_at: string | null;
  commitment_id: string;
  is_exact_body: false;
};

export type PatReadSnapshot30d = {
  field: "strength" | "pattern" | "next_move";
  text: string;
  source: string;
  is_ai_snapshot: true;
  commitment_id: string;
};

export type Memory30dRuntimeHints = {
  pattern_internal_hint?: string | null;
  goal_adjustment_internal_hint?: string | null;
  evolution_pattern_hint?: string | null;
};

export type RelationshipMemory30dData = {
  window_days: typeof RELATIONSHIP_MEMORY_30D_WINDOW_DAYS;
  built_at: string;
  commitment_id: string;
  season: {
    label: string | null;
    started_at: string | null;
    source: string | null;
  } | null;
  outcome_counts_30d: {
    yes: number;
    no: number;
    partial: number;
    blockers: number;
    checks_sent: number;
    overlay_activated: number;
    overlay_declined: number;
    reactivation_yes: number;
  };
  recurring_blockers: RecurringBlocker30d[];
  meaningful_proof: Proof30d[];
  adjustments: Adjustment30d[];
  goal_changes: GoalChange30d[];
  comebacks: Comeback30d[];
  voice_preferences: VoicePreference30d | null;
  pat_read_snapshot: PatReadSnapshot30d[];
  runtime_hints?: Memory30dRuntimeHints;
};

export type RelationshipMemory30dResult = RelationshipMemory30dData & {
  meta: {
    item_count: number;
    sources_used: string[];
    truncated?: boolean;
  };
};

const PROOF_MOMENT_LABELS: Record<string, string> = {
  comeback_after_miss: "came back after a miss",
  followed_through: "followed through on the bar",
  streak_continued: "stacked honest yeses",
  first_completion: "first clear yes on this bar",
  meaningful_streak: "sustained honest yes streak",
  honest_miss: "answered honestly on a miss",
  partial_but_stayed_engaged: "stayed engaged on a partial",
  blocker_named: "named the obstacle instead of disappearing",
  repair_trust: "repaired clarity after friction",
  memory_updated: "confirmed coaching context on SMS",
  commitment_tightened: "tightened the bar with intention",
  commitment_replaced: "chose a clearer commitment",
};

const GOAL_CHANGE_PROOF_TYPES = new Set(["commitment_tightened", "commitment_replaced"]);

const GUIDED_COMPLETE_RESOLUTIONS = new Set(["still", "change", "keep", "tighten", "new"]);
const GUIDED_ABANDON_RESOLUTIONS = new Set(["aborted_unclear", "aborted_timeout"]);

function truncateEvidence(text: string, max = MAX_MEMORY_30D_EVIDENCE_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return null;
}

function messageSidFromPayload(p: Record<string, unknown> | null): string | null {
  if (!p) return null;
  const sid = p.message_sid ?? p.inbound_message_sid;
  if (typeof sid === "string" && sid.trim()) return sid.trim();
  return null;
}

function withinWindow(iso: string, cutoffMs: number, nowMs: number): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= cutoffMs && t <= nowMs;
}

function proofLabel(proofType: string): string {
  return PROOF_MOMENT_LABELS[proofType] ?? proofType.replace(/_/g, " ");
}

function payloadMessage(p: Record<string, unknown> | null): string {
  if (!p) return "";
  const msg = typeof p.message === "string" ? p.message : "";
  const preview = typeof p.message_preview === "string" ? p.message_preview : "";
  return `${msg} ${preview}`.trim();
}

function blockerConfidence(count: number): "low" | "medium" | "high" {
  if (count >= 4) return "high";
  if (count >= 3) return "medium";
  return "low";
}

function countMemory30dItems(data: RelationshipMemory30dData): number {
  return (
    data.recurring_blockers.length +
    data.meaningful_proof.length +
    data.adjustments.length +
    data.goal_changes.length +
    data.comebacks.length +
    (data.voice_preferences ? 1 : 0) +
    data.pat_read_snapshot.length +
    (data.runtime_hints?.pattern_internal_hint ? 1 : 0) +
    (data.runtime_hints?.goal_adjustment_internal_hint ? 1 : 0) +
    (data.runtime_hints?.evolution_pattern_hint ? 1 : 0)
  );
}

function buildRecurringBlockers(
  eventsNewestFirst: V2EventRowForAi[],
  cutoffMs: number,
  nowMs: number,
  commitmentId: string
): RecurringBlocker30d[] {
  const byCanonical = new Map<
    string,
    { examples: RecurringBlocker30dExample[]; lastSeenAt: string; totalCount: number }
  >();

  for (const e of eventsNewestFirst) {
    if (e.event_type !== "blocker_captured") continue;
    if (!withinWindow(e.occurred_at, cutoffMs, nowMs)) continue;
    const p = payloadRecord(e.payload_json);
    const text = payloadMessage(p);
    const canonical = normalizeSmsPatternSignalText(text);
    if (!canonical || canonical === "other") continue;
    const msg = typeof p?.message === "string" ? p.message.trim() : "";
    const example: RecurringBlocker30dExample = {
      evidence: msg ? truncateEvidence(msg) : canonical.replace(/_/g, " "),
      at: e.occurred_at,
      source: `v2_commitment_event:blocker_captured:${canonical}`,
      message_sid: messageSidFromPayload(p),
      commitment_id: commitmentId,
      is_exact_body: Boolean(msg),
    };
    const existing = byCanonical.get(canonical);
    if (!existing) {
      byCanonical.set(canonical, {
        examples: [example],
        lastSeenAt: e.occurred_at,
        totalCount: 1,
      });
    } else {
      existing.totalCount += 1;
      if (existing.examples.length < MAX_MEMORY_30D_ITEMS_PER_CATEGORY) {
        existing.examples.push(example);
      }
      if (new Date(e.occurred_at).getTime() > new Date(existing.lastSeenAt).getTime()) {
        existing.lastSeenAt = e.occurred_at;
      }
    }
  }

  const blockers: RecurringBlocker30d[] = [];
  for (const [canonical, bucket] of byCanonical) {
    if (bucket.totalCount < MIN_RECURRING_BLOCKER_EVIDENCE_COUNT) continue;
    blockers.push({
      canonical,
      evidence_count: bucket.totalCount,
      examples: bucket.examples.slice(0, MAX_MEMORY_30D_ITEMS_PER_CATEGORY),
      last_seen_at: bucket.lastSeenAt,
      confidence: blockerConfidence(bucket.totalCount),
      commitment_id: commitmentId,
    });
  }

  return blockers
    .sort((a, b) => b.evidence_count - a.evidence_count)
    .slice(0, MAX_MEMORY_30D_ITEMS_PER_CATEGORY);
}

function detectComebacks30d(
  eventsAsc: V2EventRowForAi[],
  cutoffMs: number,
  nowMs: number,
  commitmentId: string
): Comeback30d[] {
  const comebacks: Comeback30d[] = [];
  let seenNegAt: string | null = null;
  let seenNegType: string | null = null;

  for (const e of eventsAsc) {
    if (!withinWindow(e.occurred_at, cutoffMs, nowMs)) continue;

    if (e.event_type === "user_no" || e.event_type === "user_partial") {
      seenNegAt = e.occurred_at;
      seenNegType = e.event_type;
      continue;
    }

    if (e.event_type === "user_yes" && seenNegAt && seenNegType) {
      comebacks.push({
        summary: "comeback_after_miss_or_partial",
        evidence: truncateEvidence(`${seenNegType} at ${seenNegAt} → user_yes at ${e.occurred_at}`),
        at: e.occurred_at,
        source: "v2_commitment_event:comeback_chain",
        message_sid: messageSidFromPayload(payloadRecord(e.payload_json)),
        commitment_id: commitmentId,
        is_exact_body: false,
      });
      seenNegAt = null;
      seenNegType = null;
      if (comebacks.length >= MAX_MEMORY_30D_ITEMS_PER_CATEGORY) break;
    }
  }

  return comebacks;
}

function buildPatReadSnapshot(
  victoryBackground: V3VictoryBackgroundFacts | null | undefined,
  commitmentId: string
): PatReadSnapshot30d[] {
  if (!victoryBackground) return [];
  const out: PatReadSnapshot30d[] = [];
  const pairs: Array<{ field: PatReadSnapshot30d["field"]; text: string | null | undefined }> = [
    { field: "strength", text: victoryBackground.pat_read_strength },
    { field: "pattern", text: victoryBackground.pat_read_pattern },
    { field: "next_move", text: victoryBackground.pat_read_next_move },
  ];
  for (const { field, text } of pairs) {
    const t = text?.trim();
    if (!t) continue;
    out.push({
      field,
      text: truncateEvidence(t, 220),
      source: "v2_victory_pat_read_snapshot",
      is_ai_snapshot: true,
      commitment_id: commitmentId,
    });
  }
  return out;
}

function buildVoicePreferences(
  coachingMemory: V2CoachingMemoryForPrompt | null | undefined,
  commitmentId: string
): VoicePreference30d | null {
  const rp = coachingMemory?.sms_relationship_profile;
  if (!rp) return null;
  return {
    directness_band: rp.directness_band,
    message_density_tolerance: rp.message_density_tolerance,
    comeback_sensitivity: rp.comeback_sensitivity,
    simplification_bias: rp.simplification_bias,
    evidence: truncateEvidence(JSON.stringify(rp.signals_snapshot), 200),
    source: "v2_commitment_coaching_memory.relationship_profile",
    updated_at: coachingMemory?.relationship_profile_updated_at?.trim() ?? null,
    commitment_id: commitmentId,
    is_exact_body: false,
  };
}

export function buildRelationshipMemory30d(args: {
  commitmentId: string;
  now?: Date;
  timezone?: string;
  preloadedEvents30d?: V2EventRowForAi[];
  coachingMemory?: V2CoachingMemoryForPrompt | null;
  victoryBackground?: V3VictoryBackgroundFacts | null;
  reactivationEnteredAt?: string | null;
  accountabilityPhase?: V2AccountabilityPhase | string | null;
}): RelationshipMemory30dResult {
  void args.timezone;

  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - RELATIONSHIP_MEMORY_30D_WINDOW_MS;
  const commitmentId = args.commitmentId;
  const events = args.preloadedEvents30d ?? [];
  const sourcesUsed = new Set<string>();

  const signals = computeRelationshipSignals(
    events,
    {
      reactivation_entered_at: args.reactivationEnteredAt ?? args.coachingMemory?.reactivation_entered_at ?? null,
      accountability_phase: (args.accountabilityPhase ??
        args.coachingMemory?.accountability_phase ??
        "active_accountability") as V2AccountabilityPhase,
    },
    nowMs
  );
  sourcesUsed.add("v2_commitment_event:30d_signals");

  let blockersCount = 0;
  const meaningfulProof: Proof30d[] = [];
  const proofTypesSeen = new Set<string>();
  const adjustments: Adjustment30d[] = [];
  const goalChanges: GoalChange30d[] = [];
  const goalKindsSeen = new Set<string>();

  const eventsAsc = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  const eventsNewestFirst = [...eventsAsc].reverse();

  for (const e of eventsNewestFirst) {
    if (!withinWindow(e.occurred_at, cutoffMs, nowMs)) continue;
    const p = payloadRecord(e.payload_json);
    const sid = messageSidFromPayload(p);
    const source = `v2_commitment_event:${e.event_type}`;

    if (e.event_type === "blocker_captured") {
      blockersCount += 1;
    }

    if (
      e.event_type === "contract_overlay_activated" ||
      e.event_type === "contract_overlay_declined"
    ) {
      if (adjustments.length < MAX_MEMORY_30D_ITEMS_PER_CATEGORY) {
        const kind = e.event_type.replace("contract_overlay_", "");
        const contractKind =
          typeof p?.contract_kind === "string" ? p.contract_kind.trim() : "";
        adjustments.push({
          kind,
          summary: `contract_overlay_${kind}`,
          evidence: contractKind
            ? truncateEvidence(`${kind}: ${contractKind}`)
            : e.event_type.replace(/_/g, " "),
          at: e.occurred_at,
          source,
          message_sid: sid,
          commitment_id: commitmentId,
          is_exact_body: false,
        });
        sourcesUsed.add("v2_commitment_event:contract_overlay");
      }
    }

    if (e.event_type === "coaching_refresh_resolved") {
      if (adjustments.length < MAX_MEMORY_30D_ITEMS_PER_CATEGORY) {
        const resolution = typeof p?.resolution === "string" ? p.resolution.trim() : "";
        const summary = GUIDED_COMPLETE_RESOLUTIONS.has(resolution)
          ? "coaching_refresh_completed"
          : GUIDED_ABANDON_RESOLUTIONS.has(resolution)
            ? "coaching_refresh_abandoned"
            : "coaching_refresh_resolved";
        adjustments.push({
          kind: "coaching_refresh_resolved",
          summary,
          evidence: resolution ? truncateEvidence(`resolution=${resolution}`) : "coaching_refresh_resolved",
          at: e.occurred_at,
          source,
          message_sid: sid,
          commitment_id: commitmentId,
          is_exact_body: false,
        });
        sourcesUsed.add("v2_commitment_event:coaching_refresh");
      }
    }

    if (p?.proof_moment === true) {
      const proofType = typeof p.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
      if (proofType && GOAL_CHANGE_PROOF_TYPES.has(proofType) && !goalKindsSeen.has(proofType)) {
        goalKindsSeen.add(proofType);
        if (goalChanges.length < MAX_MEMORY_30D_ITEMS_PER_CATEGORY) {
          goalChanges.push({
            kind: proofType,
            summary: proofLabel(proofType),
            evidence: proofLabel(proofType),
            at: e.occurred_at,
            source: `v2_commitment_event:goal_change:${e.event_type}`,
            message_sid: sid,
            commitment_id: commitmentId,
            is_exact_body: false,
          });
          sourcesUsed.add("v2_commitment_event:goal_change");
        }
      } else if (
        proofType &&
        !proofTypesSeen.has(proofType) &&
        meaningfulProof.length < MAX_MEMORY_30D_PROOF_ITEMS
      ) {
        proofTypesSeen.add(proofType);
        meaningfulProof.push({
          summary: proofLabel(proofType),
          proof_type: proofType,
          evidence: proofLabel(proofType),
          at: e.occurred_at,
          source: `v2_commitment_event:proof_moment:${e.event_type}`,
          message_sid: sid,
          commitment_id: commitmentId,
          is_exact_body: false,
        });
        sourcesUsed.add("v2_commitment_event:proof_moment");
      }
    }

    if (e.event_type === "sms_memory_signal") {
      const ms = p?.memory_signal;
      const msObj = ms != null && typeof ms === "object" && !Array.isArray(ms) ? (ms as Record<string, unknown>) : null;
      if (msObj?.wave12_commitment_change_proof === true) {
        const proofType =
          typeof p?.proof_moment_type === "string" ? p.proof_moment_type.trim() : "";
        if (
          proofType &&
          GOAL_CHANGE_PROOF_TYPES.has(proofType) &&
          !goalKindsSeen.has(proofType) &&
          goalChanges.length < MAX_MEMORY_30D_ITEMS_PER_CATEGORY
        ) {
          goalKindsSeen.add(proofType);
          goalChanges.push({
            kind: proofType,
            summary: proofLabel(proofType),
            evidence: proofLabel(proofType),
            at: e.occurred_at,
            source: "v2_commitment_event:sms_memory_signal:wave12",
            message_sid: sid,
            commitment_id: commitmentId,
            is_exact_body: false,
          });
          sourcesUsed.add("v2_commitment_event:goal_change");
        }
      }
    }
  }

  const recurring_blockers = buildRecurringBlockers(eventsNewestFirst, cutoffMs, nowMs, commitmentId);
  if (recurring_blockers.length) sourcesUsed.add("v2_commitment_event:recurring_blockers");

  const comebacks = detectComebacks30d(eventsAsc, cutoffMs, nowMs, commitmentId);
  if (comebacks.length) sourcesUsed.add("v2_commitment_event:comeback_chain");

  const pat_read_snapshot = buildPatReadSnapshot(args.victoryBackground, commitmentId);
  if (pat_read_snapshot.length) sourcesUsed.add("v2_victory_pat_read_snapshot");

  const voice_preferences = buildVoicePreferences(args.coachingMemory, commitmentId);
  if (voice_preferences) sourcesUsed.add("v2_commitment_coaching_memory.relationship_profile");

  const vb = args.victoryBackground;
  const season =
    vb?.active_season_label?.trim() || vb?.active_season_started_at?.trim()
      ? {
          label: vb.active_season_label?.trim() ?? null,
          started_at: vb.active_season_started_at?.trim() ?? null,
          source: "user_accountability_season",
        }
      : null;
  if (season) sourcesUsed.add("user_accountability_season");

  const data: RelationshipMemory30dData = {
    window_days: RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
    built_at: now.toISOString(),
    commitment_id: commitmentId,
    season,
    outcome_counts_30d: {
      yes: signals.yes_30d,
      no: signals.no_30d,
      partial: signals.partial_30d,
      blockers: blockersCount,
      checks_sent: signals.check_sent_30d,
      overlay_activated: signals.overlay_activated_30d,
      overlay_declined: signals.overlay_declined_30d,
      reactivation_yes: signals.reactivation_yes_30d,
    },
    recurring_blockers,
    meaningful_proof: meaningfulProof,
    adjustments: adjustments.slice(0, MAX_MEMORY_30D_ITEMS_PER_CATEGORY),
    goal_changes: goalChanges,
    comebacks,
    voice_preferences,
    pat_read_snapshot,
  };

  return {
    ...data,
    meta: {
      item_count: countMemory30dItems(data),
      sources_used: [...sourcesUsed],
      truncated: false,
    },
  };
}

function dropOldestFromArray<T>(arr: T[]): T[] {
  if (arr.length <= 1) return [];
  return arr.slice(1);
}

/** Trim section G data to fit budget before packet-level deletion. */
export function trimRelationshipMemory30dData(
  data: RelationshipMemory30dData,
  maxChars: number
): { data: RelationshipMemory30dData; truncated: boolean } {
  let working: RelationshipMemory30dData = { ...data };
  let truncated = false;

  const size = () => JSON.stringify(working).length;
  if (size() <= maxChars) {
    return { data: working, truncated: false };
  }

  const trimStep = (): boolean => {
    const hints = working.runtime_hints ? { ...working.runtime_hints } : undefined;
    if (hints?.evolution_pattern_hint) {
      delete hints.evolution_pattern_hint;
      working = { ...working, runtime_hints: Object.keys(hints).length ? hints : undefined };
      return true;
    }
    if (hints?.goal_adjustment_internal_hint) {
      delete hints.goal_adjustment_internal_hint;
      working = { ...working, runtime_hints: Object.keys(hints).length ? hints : undefined };
      return true;
    }
    if (hints?.pattern_internal_hint) {
      delete hints.pattern_internal_hint;
      working = { ...working, runtime_hints: undefined };
      return true;
    }
    if (working.pat_read_snapshot.length > 0) {
      working = { ...working, pat_read_snapshot: dropOldestFromArray(working.pat_read_snapshot) };
      return true;
    }
    if (working.voice_preferences) {
      working = { ...working, voice_preferences: null };
      return true;
    }
    if (working.comebacks.length > 0) {
      working = { ...working, comebacks: dropOldestFromArray(working.comebacks) };
      return true;
    }
    if (working.goal_changes.length > 0) {
      working = { ...working, goal_changes: dropOldestFromArray(working.goal_changes) };
      return true;
    }
    if (working.adjustments.length > 0) {
      working = { ...working, adjustments: dropOldestFromArray(working.adjustments) };
      return true;
    }
    if (working.meaningful_proof.length > 0) {
      working = { ...working, meaningful_proof: dropOldestFromArray(working.meaningful_proof) };
      return true;
    }
    if (working.recurring_blockers.length > 0) {
      const blockers = [...working.recurring_blockers];
      const last = blockers[blockers.length - 1];
      if (last && last.examples.length > 1) {
        blockers[blockers.length - 1] = {
          ...last,
          examples: last.examples.slice(0, -1),
          evidence_count: last.examples.length - 1,
        };
        working = { ...working, recurring_blockers: blockers };
        return true;
      }
      working = { ...working, recurring_blockers: dropOldestFromArray(blockers) };
      return true;
    }
    return false;
  };

  let guard = 0;
  while (size() > maxChars && guard < 50) {
    guard += 1;
    if (!trimStep()) break;
    truncated = true;
  }

  return { data: working, truncated };
}

export function countRelationshipMemory30dItems(data: RelationshipMemory30dData): number {
  return countMemory30dItems(data);
}

/**
 * V2 SMS: long-horizon relationship profile (v1).
 * Rule-derived only — no AI mutation. Stored on `v2_commitment_coaching_memory`.
 */

import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import { supabaseServer } from "@/lib/supabase-server";

export const SMS_RELATIONSHIP_PROFILE_VERSION = "sms_relationship_v1" as const;

export type DirectnessBand = "softer" | "standard" | "firmer";
export type MessageDensityTolerance = "low" | "medium" | "high";
export type ComebackSensitivity = "low_pressure_first" | "standard";
export type SimplificationBias = "hold_line" | "neutral" | "prefer_simplify";

export type RelationshipSignalsSnapshot = {
  window_days: 30;
  outcome_total_30d: number;
  yes_30d: number;
  no_30d: number;
  partial_30d: number;
  check_sent_30d: number;
  overlay_activated_30d: number;
  overlay_declined_30d: number;
  /** user_yes at/after `reactivation_entered_at` when set. */
  reactivation_yes_30d: number;
  guided_refresh_completed_30d: number;
  guided_refresh_abandoned_30d: number;
};

export type V1SmsRelationshipProfile = {
  version: typeof SMS_RELATIONSHIP_PROFILE_VERSION;
  directness_band: DirectnessBand;
  directness_confidence: number;
  message_density_tolerance: MessageDensityTolerance;
  message_density_confidence: number;
  comeback_sensitivity: ComebackSensitivity;
  comeback_confidence: number;
  simplification_bias: SimplificationBias;
  simplification_confidence: number;
  signals_snapshot: RelationshipSignalsSnapshot;
  /** Short rule-trace for operators (no free-text psych). */
  rule_notes: string[];
};

const MS_DAY = 86400000;
const WINDOW_DAYS = 30 as const;
const WINDOW_MS = WINDOW_DAYS * MS_DAY;

/** Same bounded spine types as coaching / AI; 30d window with higher row cap than 14d AI tail. */
const RELATIONSHIP_EVENT_TYPES = [
  "check_sent",
  "user_yes",
  "user_no",
  "user_partial",
  "blocker_captured",
  "contract_overlay_proposed",
  "contract_overlay_activated",
  "contract_overlay_declined",
  "coaching_refresh_prompted",
  "coaching_refresh_resolved",
] as const;

const RELATIONSHIP_MAX_EVENTS = 500;

const GUIDED_ABANDON_RESOLUTIONS = new Set(["aborted_unclear", "aborted_timeout"]);
const GUIDED_COMPLETE_RESOLUTIONS = new Set(["still", "change", "keep", "tighten", "new"]);

function eventTimeMs(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Bounded recent events for relationship counters (newest first). */
export async function fetchEventsForRelationshipProfile(
  commitmentId: string
): Promise<V2EventRowForAi[]> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .in("event_type", [...RELATIONSHIP_EVENT_TYPES])
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(RELATIONSHIP_MAX_EVENTS);

  if (error) {
    console.error("[v2-sms-relationship-profile] fetch events failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    event_type: String(row.event_type),
    occurred_at: String(row.occurred_at),
    payload_json:
      row.payload_json != null && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
        ? (row.payload_json as Record<string, unknown>)
        : {},
  }));
}

/**
 * Pure: rolling 30d counters from spine rows + commitment mirrors (reactivation timestamp only).
 */
export function computeRelationshipSignals(
  eventsNewestFirst: V2EventRowForAi[],
  commitment: Pick<
    ActiveV2CommitmentRow,
    "reactivation_entered_at" | "accountability_phase"
  >,
  nowMs: number
): RelationshipSignalsSnapshot {
  const reactivationMs =
    commitment.reactivation_entered_at && commitment.reactivation_entered_at.trim()
      ? eventTimeMs(commitment.reactivation_entered_at.trim())
      : null;

  let yes = 0;
  let no = 0;
  let partial = 0;
  let checks = 0;
  let overlayOn = 0;
  let overlayOff = 0;
  let reactivationYes = 0;
  let guidedDone = 0;
  let guidedAbandon = 0;

  const windowStart = nowMs - WINDOW_MS;

  for (const e of eventsNewestFirst) {
    const t = eventTimeMs(e.occurred_at);
    if (t < windowStart || t > nowMs) continue;
    switch (e.event_type) {
      case "user_yes":
        yes += 1;
        if (reactivationMs != null && t >= reactivationMs) reactivationYes += 1;
        break;
      case "user_no":
        no += 1;
        break;
      case "user_partial":
        partial += 1;
        break;
      case "check_sent":
        checks += 1;
        break;
      case "contract_overlay_activated":
        overlayOn += 1;
        break;
      case "contract_overlay_declined":
        overlayOff += 1;
        break;
      case "coaching_refresh_resolved": {
        const r =
          typeof e.payload_json?.resolution === "string" ? e.payload_json.resolution.trim() : "";
        if (GUIDED_ABANDON_RESOLUTIONS.has(r)) guidedAbandon += 1;
        else if (GUIDED_COMPLETE_RESOLUTIONS.has(r)) guidedDone += 1;
        break;
      }
      default:
        break;
    }
  }

  return {
    window_days: WINDOW_DAYS,
    outcome_total_30d: yes + no + partial,
    yes_30d: yes,
    no_30d: no,
    partial_30d: partial,
    check_sent_30d: checks,
    overlay_activated_30d: overlayOn,
    overlay_declined_30d: overlayOff,
    reactivation_yes_30d: reactivationYes,
    guided_refresh_completed_30d: guidedDone,
    guided_refresh_abandoned_30d: guidedAbandon,
  };
}

function outcomeEvidenceStrength(total: number): number {
  if (total >= 14) return 0.72;
  if (total >= 10) return 0.58;
  if (total >= 8) return 0.48;
  if (total >= 5) return 0.32;
  return 0.18;
}

/** Dual-threshold hysteresis vs previous band. */
function deriveDirectness(
  s: RelationshipSignalsSnapshot,
  prev: DirectnessBand | null
): { band: DirectnessBand; confidence: number; notes: string[] } {
  const t = s.outcome_total_30d;
  const notes: string[] = [];
  if (t < 8) {
    notes.push("directness:insufficient_outcomes_lt8_hold_previous_or_standard");
    return { band: prev ?? "standard", confidence: 0.2, notes };
  }
  const rnp = (s.no_30d + s.partial_30d) / t;
  const ry = s.yes_30d / t;
  const cur = prev ?? "standard";

  if (cur === "softer") {
    if (rnp <= 0.28 && ry >= 0.55) {
      notes.push("directness:exit_softer_ratio_relaxed");
      return { band: "standard", confidence: outcomeEvidenceStrength(t), notes };
    }
    notes.push("directness:dwell_softer");
    return { band: "softer", confidence: outcomeEvidenceStrength(t), notes };
  }
  if (cur === "firmer") {
    if (ry <= 0.62 || s.no_30d + s.partial_30d >= 3) {
      notes.push("directness:exit_firmer_yes_dropped_or_pushback");
      return { band: "standard", confidence: outcomeEvidenceStrength(t), notes };
    }
    notes.push("directness:dwell_firmer");
    return { band: "firmer", confidence: outcomeEvidenceStrength(t), notes };
  }

  if (rnp >= 0.42) {
    notes.push(`directness:enter_softer_rnp=${round2(rnp)}`);
    return { band: "softer", confidence: outcomeEvidenceStrength(t), notes };
  }
  if (ry >= 0.78 && s.no_30d + s.partial_30d <= 1) {
    notes.push(`directness:enter_firmer_ry=${round2(ry)}`);
    return { band: "firmer", confidence: outcomeEvidenceStrength(t), notes };
  }
  notes.push("directness:stay_standard_mid_band");
  return { band: "standard", confidence: Math.max(0.22, outcomeEvidenceStrength(t) * 0.65), notes };
}

function deriveDensity(
  s: RelationshipSignalsSnapshot,
  prev: MessageDensityTolerance | null
): { tol: MessageDensityTolerance; confidence: number; notes: string[] } {
  const notes: string[] = [];
  if (s.check_sent_30d < 5 || s.outcome_total_30d < 4) {
    notes.push("density:thin_checks_or_outcomes_hold_previous_or_medium");
    return { tol: prev ?? "medium", confidence: 0.2, notes };
  }
  const rate = s.outcome_total_30d / s.check_sent_30d;
  const cur = prev ?? "medium";

  if (cur === "high") {
    if (rate <= 0.32) {
      notes.push("density:exit_high_response_cooled");
      return { tol: "medium", confidence: 0.45, notes };
    }
    notes.push("density:dwell_high");
    return { tol: "high", confidence: 0.55, notes };
  }
  if (cur === "low") {
    if (rate >= 0.42) {
      notes.push("density:exit_low_response_improved");
      return { tol: "medium", confidence: 0.45, notes };
    }
    notes.push("density:dwell_low");
    return { tol: "low", confidence: 0.55, notes };
  }

  if (rate >= 0.52) {
    notes.push(`density:enter_high_rate=${round2(rate)}`);
    return { tol: "high", confidence: 0.52, notes };
  }
  if (rate <= 0.24) {
    notes.push(`density:enter_low_rate=${round2(rate)}`);
    return { tol: "low", confidence: 0.52, notes };
  }
  notes.push("density:stay_medium");
  return { tol: "medium", confidence: 0.38, notes };
}

function deriveComeback(
  s: RelationshipSignalsSnapshot,
  phase: V2AccountabilityPhase,
  prev: ComebackSensitivity | null
): { sens: ComebackSensitivity; confidence: number; notes: string[] } {
  const notes: string[] = [];
  const yesAfterRe = s.reactivation_yes_30d >= 1;
  const guidedAbandonHeavy =
    s.guided_refresh_abandoned_30d >= 2 &&
    s.guided_refresh_abandoned_30d > s.guided_refresh_completed_30d;

  if (yesAfterRe) {
    notes.push("comeback:yes_after_reactivation_timestamp");
    return { sens: "low_pressure_first", confidence: 0.55, notes };
  }
  if (phase === "low_pressure_reactivation" && s.outcome_total_30d >= 6 && s.yes_30d >= 3) {
    notes.push("comeback:phase_low_pressure_with_recent_yes");
    return { sens: "low_pressure_first", confidence: 0.42, notes };
  }
  if (guidedAbandonHeavy) {
    notes.push("comeback:guided_abandon_heavy_stay_standard");
    return { sens: prev ?? "standard", confidence: 0.28, notes };
  }
  notes.push("comeback:default_standard");
  return { sens: "standard", confidence: 0.22, notes };
}

function deriveSimplification(
  s: RelationshipSignalsSnapshot,
  prev: SimplificationBias | null
): { bias: SimplificationBias; confidence: number; notes: string[] } {
  const notes: string[] = [];
  const decisions = s.overlay_activated_30d + s.overlay_declined_30d;
  const t = s.outcome_total_30d;

  if (t < 8 && decisions < 3) {
    notes.push("simplification:thin_hold_previous_or_neutral");
    return { bias: prev ?? "neutral", confidence: 0.18, notes };
  }

  const cur = prev ?? "neutral";
  const declineRate = decisions > 0 ? s.overlay_declined_30d / decisions : 0;

  if (cur === "hold_line") {
    if (declineRate <= 0.34 && s.overlay_activated_30d >= 1) {
      notes.push("simplification:exit_hold_line_overlays_stabilized");
      return { bias: "neutral", confidence: 0.42, notes };
    }
    notes.push("simplification:dwell_hold_line");
    return { bias: "hold_line", confidence: 0.48, notes };
  }
  if (cur === "prefer_simplify") {
    if (s.no_30d + s.partial_30d >= 4 && s.yes_30d / Math.max(1, t) < 0.55) {
      notes.push("simplification:exit_prefer_simplify_pushback_rising");
      return { bias: "neutral", confidence: 0.44, notes };
    }
    notes.push("simplification:dwell_prefer_simplify");
    return { bias: "prefer_simplify", confidence: 0.48, notes };
  }

  if (decisions >= 3 && declineRate >= 0.5) {
    notes.push(`simplification:enter_hold_line_declineRate=${round2(declineRate)}`);
    return { bias: "hold_line", confidence: 0.52, notes };
  }
  if (s.overlay_activated_30d >= 2 && s.overlay_declined_30d === 0 && s.no_30d <= 1) {
    notes.push("simplification:enter_prefer_simplify_clean_overlay_accept");
    return { bias: "prefer_simplify", confidence: 0.5, notes };
  }
  notes.push("simplification:stay_neutral");
  return { bias: "neutral", confidence: 0.3, notes };
}

function parsePrevBands(raw: unknown): {
  directness: DirectnessBand | null;
  density: MessageDensityTolerance | null;
  comeback: ComebackSensitivity | null;
  simplification: SimplificationBias | null;
} {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { directness: null, density: null, comeback: null, simplification: null };
  }
  const o = raw as Record<string, unknown>;
  const d = o.directness_band;
  const den = o.message_density_tolerance;
  const c = o.comeback_sensitivity;
  const s = o.simplification_bias;
  return {
    directness: d === "softer" || d === "standard" || d === "firmer" ? d : null,
    density: den === "low" || den === "medium" || den === "high" ? den : null,
    comeback: c === "low_pressure_first" || c === "standard" ? c : null,
    simplification: s === "hold_line" || s === "neutral" || s === "prefer_simplify" ? s : null,
  };
}

/**
 * Pure rules layer: signals + optional previous JSON (for hysteresis fields only).
 */
export function recomputeRelationshipProfileV1(args: {
  signals: RelationshipSignalsSnapshot;
  previousProfileJson: unknown;
  accountabilityPhase: V2AccountabilityPhase;
}): V1SmsRelationshipProfile {
  const prev = parsePrevBands(args.previousProfileJson);
  const d = deriveDirectness(args.signals, prev.directness);
  const den = deriveDensity(args.signals, prev.density);
  const c = deriveComeback(args.signals, args.accountabilityPhase, prev.comeback);
  const s = deriveSimplification(args.signals, prev.simplification);

  const rule_notes = [...d.notes, ...den.notes, ...c.notes, ...s.notes].slice(0, 12);

  return {
    version: SMS_RELATIONSHIP_PROFILE_VERSION,
    directness_band: d.band,
    directness_confidence: round2(clamp01(d.confidence)),
    message_density_tolerance: den.tol,
    message_density_confidence: round2(clamp01(den.confidence)),
    comeback_sensitivity: c.sens,
    comeback_confidence: round2(clamp01(c.confidence)),
    simplification_bias: s.bias,
    simplification_confidence: round2(clamp01(s.confidence)),
    signals_snapshot: args.signals,
    rule_notes,
  };
}

function parseSignalsSnapshot(raw: unknown): RelationshipSignalsSnapshot | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (s.window_days !== 30) return null;
  const n = (k: string) => (typeof s[k] === "number" && Number.isFinite(s[k] as number) ? (s[k] as number) : null);
  const fields: (keyof RelationshipSignalsSnapshot)[] = [
    "outcome_total_30d",
    "yes_30d",
    "no_30d",
    "partial_30d",
    "check_sent_30d",
    "overlay_activated_30d",
    "overlay_declined_30d",
    "reactivation_yes_30d",
    "guided_refresh_completed_30d",
    "guided_refresh_abandoned_30d",
  ];
  const nums: Partial<Record<keyof RelationshipSignalsSnapshot, number>> = {};
  for (const k of fields) {
    const v = n(k as string);
    if (v == null) return null;
    nums[k] = v;
  }
  return {
    window_days: 30,
    outcome_total_30d: nums.outcome_total_30d!,
    yes_30d: nums.yes_30d!,
    no_30d: nums.no_30d!,
    partial_30d: nums.partial_30d!,
    check_sent_30d: nums.check_sent_30d!,
    overlay_activated_30d: nums.overlay_activated_30d!,
    overlay_declined_30d: nums.overlay_declined_30d!,
    reactivation_yes_30d: nums.reactivation_yes_30d!,
    guided_refresh_completed_30d: nums.guided_refresh_completed_30d!,
    guided_refresh_abandoned_30d: nums.guided_refresh_abandoned_30d!,
  };
}

/** Short non-authoritative hints appended to developer prompts (tone only). */
export function formatRelationshipFitOutboundHints(
  profile: V1SmsRelationshipProfile | null | undefined
): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  lines.push("RELATIONSHIP_FIT_HINTS (non-authoritative; do not change cadence, next_move, overlays, reactivation, identity gates):");
  if (profile.directness_band === "softer") {
    lines.push("- directness: allow one beat of acknowledgment before the ask; keep accountability crisp.");
  } else if (profile.directness_band === "firmer") {
    lines.push("- directness: lean slightly more declarative; avoid extra cushion words.");
  }
  if (profile.message_density_tolerance === "low") {
    lines.push("- pacing: prefer slightly shorter SMS body when otherwise equivalent.");
  } else if (profile.message_density_tolerance === "high") {
    lines.push("- pacing: user tolerates a bit more context when otherwise equivalent.");
  }
  if (profile.comeback_sensitivity === "low_pressure_first") {
    lines.push("- comeback: after quiet/reactivation, bias the first clause slightly lighter before the ask.");
  }
  if (profile.simplification_bias === "prefer_simplify") {
    lines.push("- simplification: when next_move already permits a smaller bar, slightly favor plain, concrete shrink language (still obey SHRUNK_ASK_TEXT / contract verbatim rules).");
  } else if (profile.simplification_bias === "hold_line") {
    lines.push("- simplification: avoid extra simplification sells when next_move is already permissive; keep the bar steady in tone.");
  }
  return lines;
}

export function normalizeRelationshipProfileForPrompt(raw: unknown): V1SmsRelationshipProfile | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SMS_RELATIONSHIP_PROFILE_VERSION) return null;
  const bands = parsePrevBands(raw);
  if (!bands.directness || !bands.density || !bands.comeback || !bands.simplification) {
    return null;
  }
  const signals_snapshot = parseSignalsSnapshot(o.signals_snapshot);
  if (!signals_snapshot) return null;

  return {
    version: SMS_RELATIONSHIP_PROFILE_VERSION,
    directness_band: bands.directness,
    directness_confidence: typeof o.directness_confidence === "number" ? o.directness_confidence : 0,
    message_density_tolerance: bands.density,
    message_density_confidence:
      typeof o.message_density_confidence === "number" ? o.message_density_confidence : 0,
    comeback_sensitivity: bands.comeback,
    comeback_confidence: typeof o.comeback_confidence === "number" ? o.comeback_confidence : 0,
    simplification_bias: bands.simplification,
    simplification_confidence:
      typeof o.simplification_confidence === "number" ? o.simplification_confidence : 0,
    signals_snapshot,
    rule_notes: Array.isArray(o.rule_notes) ? o.rule_notes.filter((x): x is string => typeof x === "string") : [],
  };
}

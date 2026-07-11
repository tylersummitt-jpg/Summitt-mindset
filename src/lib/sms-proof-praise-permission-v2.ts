/**
 * Phase 3.2c — proof_and_praise_permission v2 projector for Relationship Snapshot v2.
 * Read-only writer context; final guard / OCEG remains authoritative for send.
 */

import type {
  RelationshipPacketProofVictoryPermission,
  RelationshipPacketSection,
  RelationshipPacketStructuredRecentTruth,
  RelationshipPacketV1,
} from "@/lib/sms-relationship-packet-v1";
import type { RelationshipMemory7dData } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipSnapshotRouteContext } from "@/lib/sms-relationship-snapshot-v2";

export const PROOF_PRAISE_EVIDENCE_MAX_ITEMS = 5 as const;
export const PROOF_PRAISE_QUOTE_MAX_CHARS = 160 as const;

export const DEFAULT_FORBIDDEN_PROOF_CLAIMS = [
  "saved to Victory Room",
  "I'm adding that to your Victory Room",
  "I saved that to your Victory Room",
  "logged as proof",
  "saved as proof",
  "that's proof",
  "counts as proof",
  "you proved",
] as const;

/** Soft identity VR is not forbidden; hard saved/logged/adding claims are. */
export const HARD_VICTORY_ROOM_FORBIDDEN_CLAIMS = [
  "saved to Victory Room",
  "I'm adding that to your Victory Room",
  "I saved that to your Victory Room",
  "That's now in your Victory Room",
  "logged in your Victory Room",
] as const;

export type ProofPraiseClaimType =
  | "completion"
  | "miss"
  | "partial"
  | "proof"
  | "victory_room"
  | "consistency"
  | "effort";

export type ProofPraiseEvidenceItem = {
  claim_type: ProofPraiseClaimType;
  source: string;
  event_id?: string | null;
  quote?: string | null;
  at?: string | null;
  confidence: "high" | "medium" | "low";
};

export type ProofAndPraiseAllowedOutboundClaims = {
  completion: boolean;
  miss: boolean;
  partial: boolean;
  proof: boolean;
  victory_room: boolean;
};

export type ProofAndPraisePermissionV2Data = {
  can_praise_effort: boolean;
  can_praise_consistency: boolean;
  can_claim_completion: boolean;
  can_claim_miss: boolean;
  can_claim_partial: boolean;
  can_claim_proof: boolean;
  can_reference_victory_room: boolean;
  allowed_outbound_claims: ProofAndPraiseAllowedOutboundClaims;
  forbidden_proof_claims: string[];
  evidence: ProofPraiseEvidenceItem[];
  freshness: {
    latest_evidence_at?: string | null;
    window_hours?: number | null;
  };
  writer_guidance: {
    may_praise_effort_without_proof: boolean;
    must_not_say_saved_to_victory_room_unless_allowed: boolean;
    must_not_call_something_proof_unless_allowed: boolean;
    final_guard_still_validates: true;
  };
  legacy_v1?: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null;
};

export type ProofAndPraisePermissionV2Section = {
  authority: "server_state_authoritative";
  data: ProofAndPraisePermissionV2Data;
};

export type ProofAndPraisePermissionV2Meta = {
  proof_permission_emitted: true;
  can_claim_completion: boolean;
  can_claim_miss: boolean;
  can_claim_partial: boolean;
  can_claim_proof: boolean;
  can_reference_victory_room: boolean;
  proof_evidence_count: number;
  proof_permission_sources: string[];
  proof_permission_has_legacy_v1: boolean;
};

export type ProofAndPraisePermissionV2Surface =
  | "inbound"
  | "daily"
  | "weekly"
  | "guided_contract";

export type BuildProofAndPraisePermissionV2Args = {
  surface: ProofAndPraisePermissionV2Surface;
  legacyProofVictoryPermission?: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null;
  structuredRecentTruth?: RelationshipPacketStructuredRecentTruth | null;
  currentTurn?: RelationshipPacketV1["current_turn"]["data"] | null;
  relationshipMemory7d?: RelationshipMemory7dData | null;
  routeContext?: RelationshipSnapshotRouteContext | null;
  /** Optional OCEG-style claims when already computed upstream (read-only pass-through). */
  allowedOutboundClaims?: PartialProofAndPraiseAllowedOutboundClaims | null;
  /** Budget trim: drop legacy_v1, shorten evidence, omit quotes. */
  compact?: boolean;
};

type PartialProofAndPraiseAllowedOutboundClaims = Partial<ProofAndPraiseAllowedOutboundClaims>;

function trimQuote(raw: string | null | undefined): string | null {
  const t = raw?.trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length <= PROOF_PRAISE_QUOTE_MAX_CHARS) return t;
  return `${t.slice(0, PROOF_PRAISE_QUOTE_MAX_CHARS - 1)}…`;
}

function pushEvidence(
  items: ProofPraiseEvidenceItem[],
  item: ProofPraiseEvidenceItem
): void {
  if (items.length >= PROOF_PRAISE_EVIDENCE_MAX_ITEMS) return;
  items.push({
    ...item,
    quote: trimQuote(item.quote),
  });
}

function latestEvidenceAt(items: ProofPraiseEvidenceItem[]): string | null {
  let latest: string | null = null;
  for (const e of items) {
    const at = e.at?.trim();
    if (!at) continue;
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

function forbiddenWhenDisallowed(args: {
  canClaimProof: boolean;
  canReferenceVictoryRoom: boolean;
}): string[] {
  if (args.canClaimProof && args.canReferenceVictoryRoom) return [];
  // Soft "Victory Room" identity language is not listed here — final guard + reply brief
  // own soft vs hard. Keep hard persistence / fake-proof phrases blocked when disallowed.
  const out = new Set<string>([...DEFAULT_FORBIDDEN_PROOF_CLAIMS]);
  if (!args.canReferenceVictoryRoom) {
    for (const p of HARD_VICTORY_ROOM_FORBIDDEN_CLAIMS) out.add(p);
  }
  return [...out];
}

function buildWriterGuidance(data: Pick<
  ProofAndPraisePermissionV2Data,
  "can_praise_effort" | "can_claim_proof" | "can_reference_victory_room"
>): ProofAndPraisePermissionV2Data["writer_guidance"] {
  return {
    may_praise_effort_without_proof: data.can_praise_effort,
    must_not_say_saved_to_victory_room_unless_allowed: !data.can_reference_victory_room,
    must_not_call_something_proof_unless_allowed: !data.can_claim_proof,
    final_guard_still_validates: true,
  };
}

function slimLegacyV1(
  legacySection: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null | undefined
): RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null {
  if (!legacySection) return null;
  const d = legacySection.data;
  const hint = d.proof_callout_hint;
  const slimHint =
    hint && typeof hint === "object"
      ? {
          eligible: (hint as { eligible?: boolean }).eligible ?? false,
          proof_callout_claim_saved_allowed:
            (hint as { proof_callout_claim_saved_allowed?: boolean }).proof_callout_claim_saved_allowed ??
            false,
        }
      : null;
  return {
    authority: legacySection.authority,
    data: {
      proof_signal: d.proof_signal ?? null,
      miss_signal: d.miss_signal ?? null,
      blocker_signal: d.blocker_signal ?? null,
      today_completed: d.today_completed ?? null,
      proof_callout_hint: slimHint,
      accountability_proof_hint: d.accountability_proof_hint ?? null,
      proof_or_milestone_signal: d.proof_or_milestone_signal ?? null,
      can_reference_victory_room: d.can_reference_victory_room ?? null,
      can_say_saved_as_proof: d.can_say_saved_as_proof ?? null,
      proof_saved: d.proof_saved ?? null,
    },
  };
}

function finalizeLegacyV1(
  legacySection: RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null | undefined,
  compact: boolean
): RelationshipPacketSection<RelationshipPacketProofVictoryPermission> | null {
  if (compact) return null;
  return slimLegacyV1(legacySection);
}

function capEvidenceForOutput(
  evidence: ProofPraiseEvidenceItem[],
  compact: boolean
): ProofPraiseEvidenceItem[] {
  const max = compact ? 2 : PROOF_PRAISE_EVIDENCE_MAX_ITEMS;
  return evidence.slice(0, max).map((e) =>
    compact ? { ...e, quote: null } : e
  );
}

function proofCalloutHintEligible(
  legacy: RelationshipPacketProofVictoryPermission | null | undefined
): boolean {
  const hint = legacy?.proof_callout_hint;
  if (!hint || typeof hint !== "object") return false;
  return (hint as { eligible?: boolean }).eligible === true;
}

function resolveInboundOutcomeClaims(args: {
  legacy: RelationshipPacketProofVictoryPermission | null | undefined;
  currentTurn: RelationshipPacketV1["current_turn"]["data"] | null | undefined;
}): { completion: boolean; miss: boolean; partial: boolean; sources: string[] } {
  const sources: string[] = [];
  const legacy = args.legacy;
  const evt = args.currentTurn?.deterministic_classifier_event?.trim() ?? "";
  const willWrite = args.currentTurn?.should_write_outcome_event === true;

  let completion = legacy?.today_completed === true;
  let miss = legacy?.miss_signal === true;
  let partial = false;

  if (legacy?.today_completed === true) sources.push("legacy_v1.today_completed");
  if (legacy?.miss_signal === true) sources.push("legacy_v1.miss_signal");

  if (willWrite && evt === "user_yes") {
    completion = true;
    sources.push("current_turn.user_yes");
  } else if (willWrite && evt === "user_no") {
    miss = true;
    sources.push("current_turn.user_no");
  } else if (willWrite && evt === "user_partial") {
    partial = true;
    sources.push("current_turn.user_partial");
  }

  return { completion, miss, partial, sources };
}

function resolveDailyOutcomeClaims(args: {
  legacy: RelationshipPacketProofVictoryPermission | null | undefined;
  memory7d: RelationshipMemory7dData | null | undefined;
  accountabilityDayKey: string | null | undefined;
}): { completion: boolean; miss: boolean; partial: boolean; sources: string[] } {
  const sources: string[] = [];
  const pendingActive = args.memory7d?.context_flags?.pending_plan_proof_active === true;
  if (pendingActive) {
    return { completion: false, miss: false, partial: false, sources: ["pending_plan_proof_active"] };
  }

  const dayKey = args.accountabilityDayKey?.trim() || null;
  type OutcomeCandidate = { kind: "completion" | "miss" | "partial"; at: string; source: string };
  const candidates: OutcomeCandidate[] = [];

  const win = args.memory7d?.wins?.[0];
  if (win?.at) {
    candidates.push({
      kind: "completion",
      at: win.at,
      source: "memory_7d.latest_win",
    });
  }
  const missItem = args.memory7d?.misses?.[0];
  if (missItem?.at) {
    candidates.push({
      kind: "miss",
      at: missItem.at,
      source: "memory_7d.latest_miss",
    });
  }
  const partialItem = args.memory7d?.partials?.[0];
  if (partialItem?.at) {
    candidates.push({
      kind: "partial",
      at: partialItem.at,
      source: "memory_7d.latest_partial",
    });
  }

  candidates.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
  const newest = candidates[0];
  if (!newest) {
    return { completion: false, miss: false, partial: false, sources: [] };
  }

  if (dayKey) {
    const winDay = args.memory7d?.wins?.[0]?.local_day_key?.trim();
    const missDay = args.memory7d?.misses?.[0]?.local_day_key?.trim();
    const partialDay = args.memory7d?.partials?.[0]?.local_day_key?.trim();
    const completion = winDay === dayKey;
    const miss = missDay === dayKey;
    const partial = partialDay === dayKey;
    if (completion) sources.push("memory_7d.win_day_key");
    if (miss) sources.push("memory_7d.miss_day_key");
    if (partial) sources.push("memory_7d.partial_day_key");
    return { completion, miss, partial, sources };
  }

  if (newest.kind === "completion") sources.push(newest.source);
  if (newest.kind === "miss") sources.push(newest.source);
  if (newest.kind === "partial") sources.push(newest.source);

  return {
    completion: newest.kind === "completion",
    miss: newest.kind === "miss",
    partial: newest.kind === "partial",
    sources,
  };
}

function memory7dSupportsConsistency(memory7d: RelationshipMemory7dData | null | undefined): boolean {
  if (!memory7d) return false;
  const yes = memory7d.outcome_counts?.yes ?? 0;
  return yes >= 3;
}

function buildInboundPermission(args: BuildProofAndPraisePermissionV2Args): {
  data: ProofAndPraisePermissionV2Data;
  sources: string[];
} {
  const legacySection = args.legacyProofVictoryPermission ?? null;
  const legacy = legacySection?.data ?? null;
  const sources: string[] = ["surface:inbound"];
  const evidence: ProofPraiseEvidenceItem[] = [];

  const outcome = resolveInboundOutcomeClaims({
    legacy,
    currentTurn: args.currentTurn,
  });
  sources.push(...outcome.sources);

  const hintEligible = proofCalloutHintEligible(legacy);
  const canSaySaved = legacy?.can_say_saved_as_proof === true;
  const explicitProofSignal = Boolean(legacy?.proof_or_milestone_signal?.trim());
  const canClaimProof = hintEligible || canSaySaved || explicitProofSignal;
  const canReferenceVictoryRoom = hintEligible || canSaySaved;

  if (hintEligible) {
    sources.push("proof_callout_hint.eligible");
    const hint = legacy?.proof_callout_hint as { reason?: string | null } | null | undefined;
    pushEvidence(evidence, {
      claim_type: "proof",
      source: "proof_callout_hint",
      quote: hint?.reason ?? null,
      confidence: "high",
    });
  }
  if (canSaySaved) sources.push("legacy_v1.can_say_saved_as_proof");

  if (outcome.completion) {
    pushEvidence(evidence, {
      claim_type: "completion",
      source: outcome.sources.find((s) => s.includes("completion") || s.includes("yes")) ?? "inbound_outcome",
      confidence: "high",
    });
  }
  if (outcome.miss) {
    pushEvidence(evidence, {
      claim_type: "miss",
      source: "legacy_v1.miss_signal_or_user_no",
      confidence: "high",
    });
  }
  if (outcome.partial) {
    pushEvidence(evidence, {
      claim_type: "partial",
      source: "current_turn.user_partial",
      confidence: "high",
    });
  }

  for (const pm of args.relationshipMemory7d?.proof_moments?.slice(0, 2) ?? []) {
    pushEvidence(evidence, {
      claim_type: "proof",
      source: pm.source || "memory_7d.proof_moment",
      quote: pm.evidence || pm.summary,
      at: pm.at,
      confidence: "medium",
    });
    sources.push("memory_7d.proof_moment");
  }

  const canPraiseConsistency = memory7dSupportsConsistency(args.relationshipMemory7d);
  if (canPraiseConsistency) sources.push("memory_7d.outcome_counts");

  const allowedFromPassThrough = args.allowedOutboundClaims ?? {};
  const allowed: ProofAndPraiseAllowedOutboundClaims = {
    completion: allowedFromPassThrough.completion ?? outcome.completion,
    miss: allowedFromPassThrough.miss ?? outcome.miss,
    partial: allowedFromPassThrough.partial ?? outcome.partial,
    proof: allowedFromPassThrough.proof ?? canClaimProof,
    victory_room: allowedFromPassThrough.victory_room ?? canReferenceVictoryRoom,
  };

  const data: ProofAndPraisePermissionV2Data = {
    can_praise_effort: true,
    can_praise_consistency: canPraiseConsistency,
    can_claim_completion: outcome.completion,
    can_claim_miss: outcome.miss,
    can_claim_partial: outcome.partial,
    can_claim_proof: canClaimProof,
    can_reference_victory_room: canReferenceVictoryRoom,
    allowed_outbound_claims: allowed,
    forbidden_proof_claims: forbiddenWhenDisallowed({
      canClaimProof,
      canReferenceVictoryRoom,
    }),
    evidence,
    freshness: {
      latest_evidence_at: latestEvidenceAt(evidence),
      window_hours: args.relationshipMemory7d?.window_days
        ? args.relationshipMemory7d.window_days * 24
        : 72,
    },
    writer_guidance: buildWriterGuidance({
      can_praise_effort: true,
      can_claim_proof: canClaimProof,
      can_reference_victory_room: canReferenceVictoryRoom,
    }),
    legacy_v1: legacySection,
  };

  return { data, sources };
}

function buildDailyPermission(args: BuildProofAndPraisePermissionV2Args): {
  data: ProofAndPraisePermissionV2Data;
  sources: string[];
} {
  const legacySection = args.legacyProofVictoryPermission ?? null;
  const legacy = legacySection?.data ?? null;
  const sources: string[] = ["surface:daily"];
  const evidence: ProofPraiseEvidenceItem[] = [];

  const outcome = resolveDailyOutcomeClaims({
    legacy,
    memory7d: args.relationshipMemory7d,
    accountabilityDayKey: args.currentTurn?.accountability_day_key,
  });
  sources.push(...outcome.sources);

  const proofSignal = legacy?.proof_or_milestone_signal?.trim() || null;
  const hasExplicitProofEvidence = Boolean(proofSignal);
  const pendingActive = args.relationshipMemory7d?.context_flags?.pending_plan_proof_active === true;

  const canClaimProof = hasExplicitProofEvidence && !pendingActive;
  const canReferenceVictoryRoom =
    proofCalloutHintEligible(legacy) || legacy?.can_say_saved_as_proof === true;

  if (proofSignal) {
    sources.push("legacy_v1.proof_or_milestone_signal");
    pushEvidence(evidence, {
      claim_type: "proof",
      source: "proof_or_milestone_signal",
      quote: proofSignal,
      confidence: "high",
    });
  }
  if (outcome.completion && args.relationshipMemory7d?.wins?.[0]) {
    pushEvidence(evidence, {
      claim_type: "completion",
      source: "memory_7d.win",
      quote: args.relationshipMemory7d.wins[0].evidence,
      at: args.relationshipMemory7d.wins[0].at,
      confidence: "high",
    });
  }
  if (outcome.miss && args.relationshipMemory7d?.misses?.[0]) {
    pushEvidence(evidence, {
      claim_type: "miss",
      source: "memory_7d.miss",
      quote: args.relationshipMemory7d.misses[0].evidence,
      at: args.relationshipMemory7d.misses[0].at,
      confidence: "high",
    });
  }
  if (outcome.partial && args.relationshipMemory7d?.partials?.[0]) {
    pushEvidence(evidence, {
      claim_type: "partial",
      source: "memory_7d.partial",
      quote: args.relationshipMemory7d.partials[0].evidence,
      at: args.relationshipMemory7d.partials[0].at,
      confidence: "high",
    });
  }

  const yesStreak = args.relationshipMemory7d?.outcome_counts?.yes ?? 0;
  const canPraiseConsistency = yesStreak >= 3;
  if (canPraiseConsistency) sources.push("memory_7d.yes_streak");

  const allowedFromPassThrough = args.allowedOutboundClaims ?? {};
  const allowed: ProofAndPraiseAllowedOutboundClaims = {
    completion: allowedFromPassThrough.completion ?? outcome.completion,
    miss: allowedFromPassThrough.miss ?? outcome.miss,
    partial: allowedFromPassThrough.partial ?? outcome.partial,
    proof: allowedFromPassThrough.proof ?? canClaimProof,
    victory_room: allowedFromPassThrough.victory_room ?? canReferenceVictoryRoom,
  };

  const data: ProofAndPraisePermissionV2Data = {
    can_praise_effort: !pendingActive,
    can_praise_consistency: canPraiseConsistency && !pendingActive,
    can_claim_completion: outcome.completion,
    can_claim_miss: outcome.miss,
    can_claim_partial: outcome.partial,
    can_claim_proof: canClaimProof,
    can_reference_victory_room: canReferenceVictoryRoom,
    allowed_outbound_claims: allowed,
    forbidden_proof_claims: forbiddenWhenDisallowed({
      canClaimProof,
      canReferenceVictoryRoom,
    }),
    evidence,
    freshness: {
      latest_evidence_at: latestEvidenceAt(evidence),
      window_hours: args.relationshipMemory7d?.window_days
        ? args.relationshipMemory7d.window_days * 24
        : 168,
    },
    writer_guidance: buildWriterGuidance({
      can_praise_effort: !pendingActive,
      can_claim_proof: canClaimProof,
      can_reference_victory_room: canReferenceVictoryRoom,
    }),
    legacy_v1: legacySection,
  };

  return { data, sources };
}

function buildWeeklyPermission(args: BuildProofAndPraisePermissionV2Args): {
  data: ProofAndPraisePermissionV2Data;
  sources: string[];
} {
  const legacySection = args.legacyProofVictoryPermission ?? null;
  const legacy = legacySection?.data ?? null;
  const sources: string[] = ["surface:weekly"];
  const evidence: ProofPraiseEvidenceItem[] = [];

  const weekSummary = args.structuredRecentTruth?.weekly_week_summary;
  const silentWeek =
    args.currentTurn?.silent_week === true || (weekSummary?.completed_count === 0 && weekSummary?.missed_count === 0);
  const strongWeek = args.currentTurn?.strong_week === true;

  const completedCount = weekSummary?.completed_count ?? 0;
  const missedCount = weekSummary?.missed_count ?? 0;
  const partialCount = weekSummary?.partial_count ?? 0;
  const proofHints = weekSummary?.proof_moment_hints ?? [];

  const canClaimCompletion = !silentWeek && completedCount >= 1;
  const canClaimMiss = !silentWeek && missedCount >= 1;
  const canClaimPartial = !silentWeek && partialCount >= 1;

  if (canClaimCompletion) sources.push("weekly_week_summary.completed_count");
  if (canClaimMiss) sources.push("weekly_week_summary.missed_count");
  if (canClaimPartial) sources.push("weekly_week_summary.partial_count");

  const canClaimProof = !silentWeek && proofHints.length > 0;
  const canReferenceVictoryRoom = canClaimProof && proofHints.length > 0;

  if (proofHints.length > 0) {
    sources.push("weekly_week_summary.proof_moment_hints");
    for (const hint of proofHints.slice(0, 2)) {
      pushEvidence(evidence, {
        claim_type: "proof",
        source: "weekly_proof_moment_hint",
        quote: hint,
        confidence: "high",
      });
    }
  }
  if (canClaimCompletion && completedCount > 0) {
    pushEvidence(evidence, {
      claim_type: "completion",
      source: "weekly_completed_count",
      quote: `${completedCount} completion(s) this week`,
      confidence: "medium",
    });
  }

  const canPraiseConsistency = !silentWeek && strongWeek;
  if (canPraiseConsistency) sources.push("current_turn.strong_week");

  const allowedFromPassThrough = args.allowedOutboundClaims ?? {};
  const allowed: ProofAndPraiseAllowedOutboundClaims = {
    completion: allowedFromPassThrough.completion ?? canClaimCompletion,
    miss: allowedFromPassThrough.miss ?? canClaimMiss,
    partial: allowedFromPassThrough.partial ?? canClaimPartial,
    proof: allowedFromPassThrough.proof ?? canClaimProof,
    victory_room: allowedFromPassThrough.victory_room ?? canReferenceVictoryRoom,
  };

  const praiseEffort = !silentWeek;

  const data: ProofAndPraisePermissionV2Data = {
    can_praise_effort: praiseEffort,
    can_praise_consistency: canPraiseConsistency,
    can_claim_completion: canClaimCompletion,
    can_claim_miss: canClaimMiss,
    can_claim_partial: canClaimPartial,
    can_claim_proof: canClaimProof,
    can_reference_victory_room: canReferenceVictoryRoom,
    allowed_outbound_claims: allowed,
    forbidden_proof_claims: forbiddenWhenDisallowed({
      canClaimProof,
      canReferenceVictoryRoom,
    }),
    evidence,
    freshness: {
      latest_evidence_at: latestEvidenceAt(evidence),
      window_hours: 168,
    },
    writer_guidance: buildWriterGuidance({
      can_praise_effort: praiseEffort,
      can_claim_proof: canClaimProof,
      can_reference_victory_room: canReferenceVictoryRoom,
    }),
    legacy_v1: legacySection,
  };

  return { data, sources };
}

function buildGuidedPermission(args: BuildProofAndPraisePermissionV2Args): {
  data: ProofAndPraisePermissionV2Data;
  sources: string[];
} {
  const legacySection = args.legacyProofVictoryPermission ?? null;
  const sources = ["surface:guided_contract", "guided_conservative_defaults"];

  const data: ProofAndPraisePermissionV2Data = {
    can_praise_effort: true,
    can_praise_consistency: false,
    can_claim_completion: false,
    can_claim_miss: false,
    can_claim_partial: false,
    can_claim_proof: false,
    can_reference_victory_room: false,
    allowed_outbound_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
    },
    forbidden_proof_claims: [...DEFAULT_FORBIDDEN_PROOF_CLAIMS],
    evidence: [],
    freshness: {
      latest_evidence_at: null,
      window_hours: null,
    },
    writer_guidance: buildWriterGuidance({
      can_praise_effort: true,
      can_claim_proof: false,
      can_reference_victory_room: false,
    }),
    legacy_v1: legacySection,
  };

  return { data, sources };
}

function buildDefaultPermission(args: BuildProofAndPraisePermissionV2Args): {
  data: ProofAndPraisePermissionV2Data;
  sources: string[];
} {
  const legacySection = args.legacyProofVictoryPermission ?? null;
  const sources = [`surface:${args.surface}`, "default_no_evidence"];

  const data: ProofAndPraisePermissionV2Data = {
    can_praise_effort: true,
    can_praise_consistency: false,
    can_claim_completion: false,
    can_claim_miss: false,
    can_claim_partial: false,
    can_claim_proof: false,
    can_reference_victory_room: false,
    allowed_outbound_claims: {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
    },
    forbidden_proof_claims: [...DEFAULT_FORBIDDEN_PROOF_CLAIMS],
    evidence: [],
    freshness: {
      latest_evidence_at: null,
      window_hours: null,
    },
    writer_guidance: buildWriterGuidance({
      can_praise_effort: true,
      can_claim_proof: false,
      can_reference_victory_room: false,
    }),
    legacy_v1: legacySection,
  };

  return { data, sources };
}

export function buildProofAndPraisePermissionV2(
  args: BuildProofAndPraisePermissionV2Args
): { section: ProofAndPraisePermissionV2Section; meta: ProofAndPraisePermissionV2Meta } {
  const compact = args.compact === true;
  let built: { data: ProofAndPraisePermissionV2Data; sources: string[] };

  switch (args.surface) {
    case "inbound":
      built = buildInboundPermission(args);
      break;
    case "daily":
      built = buildDailyPermission(args);
      break;
    case "weekly":
      built = buildWeeklyPermission(args);
      break;
    case "guided_contract":
      built = buildGuidedPermission(args);
      break;
    default:
      built = buildDefaultPermission(args);
  }

  if (compact) {
    built.data.evidence = [];
  } else {
    built.data.evidence = capEvidenceForOutput(built.data.evidence, false);
  }
  built.data.legacy_v1 = finalizeLegacyV1(built.data.legacy_v1 ?? args.legacyProofVictoryPermission, compact);
  if (compact) built.sources.push("compact_budget_trim");

  const meta: ProofAndPraisePermissionV2Meta = {
    proof_permission_emitted: true,
    can_claim_completion: built.data.can_claim_completion,
    can_claim_miss: built.data.can_claim_miss,
    can_claim_partial: built.data.can_claim_partial,
    can_claim_proof: built.data.can_claim_proof,
    can_reference_victory_room: built.data.can_reference_victory_room,
    proof_evidence_count: built.data.evidence.length,
    proof_permission_sources: built.sources,
    proof_permission_has_legacy_v1: built.data.legacy_v1 != null,
  };

  return {
    section: {
      authority: "server_state_authoritative",
      data: built.data,
    },
    meta,
  };
}

export function buildProofAndPraisePermissionV2PromptGuidance(): string {
  return `- proof_and_praise_permission is writer guidance only — not final send permission; finalization_context means server validates send separately.
- Effort praise (encouragement without claiming outcomes) is allowed when can_praise_effort=true even if can_claim_proof=false.
- Do not claim completion, miss, partial, or proof unless the matching can_claim_* or allowed_outbound_claims flag is true.
- Soft Victory Room identity language (belongs in / material / kind of proof) may still be appropriate on meaningful inbound wins when the inbound lane marks metaphor_only — that is owned by inbound allowed_claims / final guard, not by forbidding the words "Victory Room" here.
- Do not say saved to Victory Room, I'm adding that to your Victory Room, logged as proof, or similar hard persistence claims unless can_reference_victory_room is true; when forbidden_proof_claims is non-empty, treat those phrases as off limits.
- Completion claims and proof claims are different: completing the bar is not the same as calling something proof or a Victory Room moment.`;
}

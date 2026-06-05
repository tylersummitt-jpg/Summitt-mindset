/**
 * Earned Praise Policy v1.1 — deterministic praise allowance (no state writes).
 * Specific acknowledgment can be frequent; warm praise phrases stay rare.
 */

import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";

export type SmsPraisePolicyLaneKind = "daily" | "inbound" | "weekly";

/** Raw FVG reasons governed by earned praise policy (replaced or dropped). */
export const PRAISE_POLICY_GOVERNED_FVG_REASONS = new Set([
  "great_job",
  "keep_momentum",
]);

export type SmsWarmPraiseFamily =
  | "great_job"
  | "good_job"
  | "good_work"
  | "nice_work"
  | "proud_of_you"
  | "proud_of_this"
  | "strong_work"
  | "well_done";

export type SmsPraisePhraseFamily = SmsWarmPraiseFamily | "keep_momentum";

export const WARM_PRAISE_FAMILIES: ReadonlySet<SmsWarmPraiseFamily> = new Set([
  "great_job",
  "good_job",
  "good_work",
  "nice_work",
  "proud_of_you",
  "proud_of_this",
  "strong_work",
  "well_done",
]);

const WARM_PRAISE_PATTERNS: Array<{ family: SmsWarmPraiseFamily; re: RegExp }> = [
  { family: "great_job", re: /\bgreat job\b/i },
  { family: "good_job", re: /\bgood job\b/i },
  { family: "good_work", re: /\bgood work\b/i },
  { family: "nice_work", re: /\bnice work\b/i },
  { family: "proud_of_you", re: /\bproud of you\b/i },
  { family: "proud_of_this", re: /\bproud of this\b/i },
  { family: "strong_work", re: /\bstrong work\b/i },
  { family: "well_done", re: /\bwell done\b/i },
];

/** Legacy FVG keep-momentum hit (policy also catches broader variants). */
const KEEP_MOMENTUM_FVG_RE = /\bkeep (the |this )?momentum\b/i;

/** Generic momentum hype — v1.1 blocks unless evidence-specific (default: block). */
export const GENERIC_MOMENTUM_RE =
  /\b(keep (the |this )?momentum|continue (this )?momentum|continuing (this )?momentum|as you continue (this )?momentum|build(?:ing)? on (?:this )?momentum|carrying (?:this )?momentum|momentum going|your momentum|this momentum)\b/i;

const GENERIC_PRAISE_FILLER_RE =
  /\b(keep (it )?up|keep going|you'?ve got this|let me know how it went)\b/i;

const COMPLETION_EVIDENCE_IN_THREAD_RE =
  /\b(got it done|i did it|done today|finished|completed|made the calls|two hours|distribution time)\b/i;

/** Evidence-based acknowledgment — allowed even when warm praise is on cooldown. */
export const SPECIFIC_ACKNOWLEDGMENT_RES: RegExp[] = [
  /\b\d+\s+days? in a row\b/i,
  /\btwo days in a row\b/i,
  /\bthree straight\b/i,
  /\byou got the .{6,48} done\b/i,
  /\byou followed through on\b/i,
  /\bfollowed through on the\b/i,
  /\bcame back after\b/i,
  /\bthat'?s a real rep\b/i,
  /\bbecoming a standard\b/i,
  /\bthis is starting to become\b/i,
  /\bback-to-back\b/i,
  /\bstraight days?\b/i,
];

export type SmsPraisePolicyEvaluateArgs = {
  body: string;
  laneKind: SmsPraisePolicyLaneKind;
  routePurpose?: string | null;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  priorOutcome?: string | null;
  proofOrMilestoneSignal?: string | null;
  pendingPlanProofActive?: boolean;
  inboundMeaning?: Pick<
    InboundMeaningFacts,
    "relationship_meaning" | "persistence_decision" | "temporal_scope"
  > | null;
  relationshipMemory7d?: RelationshipMemory7dResult | null;
  recentExactThread72h?: RecentExactThread72hResult | null;
  recentCoachBodies?: string[] | null;
  latestUserInbound?: string | null;
  yesStreak14d?: number | null;
  weeklyProofHints?: string[] | null;
  weeklyStrongWeek?: boolean | null;
  weeklyCompletedCount?: number | null;
  /** True when built from lane facts (full cadence/thread context). FVG without this is strict on warm praise. */
  praisePolicyContextFromLane?: boolean;
};

export type SmsPraisePolicyResult = {
  earned_praise_allowed: boolean;
  praise_cooldown_active: boolean;
  praise_specificity_ok: boolean;
  warm_praise_recently_used: boolean;
  specific_acknowledgment_detected: boolean;
  detected_momentum_generic: boolean;
  praise_policy_reason: string;
  detected_praise_phrases: SmsPraisePhraseFamily[];
  detected_warm_praise_phrases: SmsWarmPraiseFamily[];
  blocked_reasons: string[];
  allowed_reasons: string[];
  streak_or_comeback_evidence: boolean;
};

export function detectWarmPraisePhrasesInBody(body: string): SmsWarmPraiseFamily[] {
  const t = body.trim();
  if (!t) return [];
  const out: SmsWarmPraiseFamily[] = [];
  for (const { family, re } of WARM_PRAISE_PATTERNS) {
    if (re.test(t) && !out.includes(family)) out.push(family);
  }
  return out;
}

export function detectPraisePhrasesInBody(body: string): SmsPraisePhraseFamily[] {
  const warm = detectWarmPraisePhrasesInBody(body);
  const out: SmsPraisePhraseFamily[] = [...warm];
  const t = body.trim();
  if (t && (KEEP_MOMENTUM_FVG_RE.test(t) || GENERIC_MOMENTUM_RE.test(t)) && !out.includes("keep_momentum")) {
    out.push("keep_momentum");
  }
  return out;
}

export function detectSpecificAcknowledgmentInBody(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  return SPECIFIC_ACKNOWLEDGMENT_RES.some((re) => re.test(t));
}

export function detectGenericMomentumInBody(body: string): boolean {
  return GENERIC_MOMENTUM_RE.test(body.trim());
}

function coachBodiesFromThread72h(thread?: RecentExactThread72hResult | null): string[] {
  if (!thread?.messages?.length) return [];
  return thread.messages
    .filter((m) => m.role === "coach" && m.body.trim())
    .map((m) => m.body.trim());
}

function mergeRecentCoachBodies(args: SmsPraisePolicyEvaluateArgs): string[] {
  const fromThread = coachBodiesFromThread72h(args.recentExactThread72h);
  const extra = (args.recentCoachBodies ?? []).map((b) => b.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of [...fromThread, ...extra]) {
    const key = b.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out.slice(-5);
}

export function detectRecentWarmPraiseUsage(recentCoachBodies: string[]): boolean {
  for (const body of recentCoachBodies.slice(-5)) {
    if (detectWarmPraisePhrasesInBody(body).length > 0) return true;
  }
  return false;
}

/** @deprecated Per-family overlap; v1.1 uses {@link detectRecentWarmPraiseUsage}. */
export function detectRecentPraisePhraseUsage(
  recentCoachBodies: string[],
  currentFamilies: SmsPraisePhraseFamily[] = []
): {
  families: SmsPraisePhraseFamily[];
  overlapping_families: SmsPraisePhraseFamily[];
  cooldown_active: boolean;
} {
  const warmRecentlyUsed = detectRecentWarmPraiseUsage(recentCoachBodies);
  const recentFamilies = new Set<SmsPraisePhraseFamily>();
  for (const body of recentCoachBodies.slice(-5)) {
    for (const f of detectPraisePhrasesInBody(body)) {
      recentFamilies.add(f);
    }
  }
  const overlapping = currentFamilies.filter((f) => recentFamilies.has(f));
  return {
    families: [...recentFamilies],
    overlapping_families: overlapping,
    cooldown_active: warmRecentlyUsed || overlapping.length > 0,
  };
}

function tokenizeForAnchor(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

function hasFreshCompletionSignal(args: SmsPraisePolicyEvaluateArgs): boolean {
  const inbound = args.latestUserInbound?.trim() ?? "";
  if (COMPLETION_EVIDENCE_IN_THREAD_RE.test(inbound)) return true;
  const userMsgs =
    args.recentExactThread72h?.messages.filter((m) => m.role === "user").slice(-3) ?? [];
  for (const m of userMsgs) {
    if (COMPLETION_EVIDENCE_IN_THREAD_RE.test(m.body)) return true;
  }
  return false;
}

function hasStreakOrComebackEvidence(args: SmsPraisePolicyEvaluateArgs): boolean {
  if ((args.yesStreak14d ?? 0) >= 2) return true;
  const mem = args.relationshipMemory7d;
  if (mem?.comebacks.length) return true;
  if ((mem?.outcome_counts?.yes ?? 0) >= 2) return true;
  if (args.weeklyStrongWeek === true) return true;
  if ((args.weeklyCompletedCount ?? 0) >= 2) return true;
  return false;
}

/** Strong tier required to authorize warm praise (not stale wins alone). */
function hasWarmPraiseAuthorization(args: SmsPraisePolicyEvaluateArgs): boolean {
  if (args.pendingPlanProofActive) return false;

  const meaning = args.inboundMeaning;
  if (
    meaning?.relationship_meaning === "reported_completion" &&
    meaning.persistence_decision === "write_user_yes_today"
  ) {
    return true;
  }

  if (args.proofOrMilestoneSignal?.trim()) return true;

  if (hasStreakOrComebackEvidence(args)) return true;

  const hints = args.weeklyProofHints ?? [];
  if (hints.length > 0) return true;

  if (hasFreshCompletionSignal(args)) return true;

  const prior = (args.priorOutcome ?? "").trim().toLowerCase();
  if (prior === "user_yes") return true;

  const mem = args.relationshipMemory7d;
  if (mem?.proof_moments.length) return true;
  if (mem?.comebacks.length) return true;
  if (
    (mem?.outcome_counts?.yes ?? 0) >= 1 &&
    mem?.context_flags?.days_since_last_user_outcome != null &&
    mem?.context_flags?.days_since_last_user_outcome <= 3
  ) {
    return true;
  }

  if (args.weeklyStrongWeek === true) return true;
  if ((args.weeklyCompletedCount ?? 0) >= 1) return true;

  return false;
}

function hasWarmPraiseSpecificityAnchor(body: string, args: SmsPraisePolicyEvaluateArgs): boolean {
  const t = body.trim();
  if (!t) return false;

  if (/^(great job|good job|good work|nice work|proud of you|well done|strong work)[!.?\s—-]*$/i.test(t)) {
    return false;
  }

  if (GENERIC_PRAISE_FILLER_RE.test(t) && t.length < 90) return false;

  if (detectSpecificAcknowledgmentInBody(t)) return true;

  const bodyLower = t.toLowerCase();
  const askTokens = tokenizeForAnchor(
    [args.effectiveAsk, args.behaviorStatement].filter(Boolean).join(" ")
  ).filter((w) => w.length >= 5);
  if (askTokens.some((tok) => bodyLower.includes(tok))) return true;

  if (/\b\d+\s*(hours?|minutes?|mins?|calls|steps|reps?)\b/i.test(t)) return true;

  if (args.proofOrMilestoneSignal?.trim()) {
    const proofChunk = args.proofOrMilestoneSignal.trim().slice(0, 24).toLowerCase();
    if (proofChunk.length >= 6 && bodyLower.includes(proofChunk)) return true;
  }

  if (args.latestUserInbound?.trim()) {
    const inboundTokens = tokenizeForAnchor(args.latestUserInbound).slice(0, 8);
    if (inboundTokens.some((tok) => tok.length >= 5 && bodyLower.includes(tok))) return true;
  }

  if (/\bgetting it done\b/i.test(t) && !askTokens.some((tok) => bodyLower.includes(tok))) {
    return false;
  }

  if (
    /\?/.test(t) &&
    t.length > 50 &&
    (askTokens.some((tok) => bodyLower.includes(tok)) ||
      /\b(calls|hours|distribution|focus|rep|reps)\b/i.test(t))
  ) {
    return true;
  }

  return false;
}

function hasCadenceContext(args: SmsPraisePolicyEvaluateArgs): boolean {
  return mergeRecentCoachBodies(args).length > 0 || args.praisePolicyContextFromLane === true;
}

function isGenericMomentumEvidenceSpecific(body: string, args: SmsPraisePolicyEvaluateArgs): boolean {
  if (!detectGenericMomentumInBody(body)) return false;
  return (
    detectSpecificAcknowledgmentInBody(body) &&
    hasWarmPraiseSpecificityAnchor(body, args) &&
    hasStreakOrComebackEvidence(args)
  );
}

export function evaluateSmsPraisePolicy(args: SmsPraisePolicyEvaluateArgs): SmsPraisePolicyResult {
  const body = args.body;
  const warmPhrases = detectWarmPraisePhrasesInBody(body);
  const detected = detectPraisePhrasesInBody(body);
  const recentCoach = mergeRecentCoachBodies(args);
  const warmRecentlyUsed = detectRecentWarmPraiseUsage(recentCoach);
  const specificAck = detectSpecificAcknowledgmentInBody(body);
  const momentumGeneric = detectGenericMomentumInBody(body);
  const streakEvidence = hasStreakOrComebackEvidence(args);
  const warmAuthorized = hasWarmPraiseAuthorization(args);
  const warmSpecificityOk = warmPhrases.length === 0 || hasWarmPraiseSpecificityAnchor(body, args);

  const blocked: string[] = [];
  const allowed: string[] = [];

  if (warmPhrases.length === 0 && !momentumGeneric) {
    return {
      earned_praise_allowed: warmAuthorized,
      praise_cooldown_active: warmRecentlyUsed,
      praise_specificity_ok: true,
      warm_praise_recently_used: warmRecentlyUsed,
      specific_acknowledgment_detected: specificAck,
      detected_momentum_generic: false,
      praise_policy_reason: specificAck ? "specific_acknowledgment_only" : "no_praise_phrases",
      detected_praise_phrases: [],
      detected_warm_praise_phrases: [],
      blocked_reasons: [],
      allowed_reasons: specificAck ? ["specific_acknowledgment_ok"] : [],
      streak_or_comeback_evidence: streakEvidence,
    };
  }

  if (momentumGeneric) {
    if (!isGenericMomentumEvidenceSpecific(body, args)) {
      blocked.push("generic_momentum");
    } else {
      allowed.push("momentum_evidence_specific_ok");
    }
  }

  if (warmPhrases.length > 0) {
    const strictFvg = args.praisePolicyContextFromLane !== true && !hasCadenceContext(args);

    if (strictFvg) {
      blocked.push("generic_praise_insufficient_context");
    } else if (!warmAuthorized) {
      blocked.push("generic_praise_unearned");
    } else if (warmRecentlyUsed) {
      blocked.push("generic_praise_overused_warm_family");
    } else if (!warmSpecificityOk) {
      blocked.push("generic_praise_vague");
    } else {
      allowed.push("earned_specific_warm_praise_ok");
    }
  }

  let reason = "praise_evaluated";
  if (blocked.includes("generic_praise_insufficient_context")) reason = "praise_insufficient_context";
  else if (blocked.includes("generic_praise_unearned")) reason = "praise_unearned";
  else if (blocked.includes("generic_praise_overused_warm_family")) reason = "praise_warm_family_overused";
  else if (blocked.includes("generic_praise_vague")) reason = "praise_vague";
  else if (blocked.includes("generic_momentum")) reason = "momentum_generic";
  else if (allowed.length) reason = "praise_allowed";

  return {
    earned_praise_allowed:
      warmAuthorized && !blocked.some((b) => b.startsWith("generic_praise") || b === "generic_momentum"),
    praise_cooldown_active: warmRecentlyUsed,
    praise_specificity_ok: warmSpecificityOk,
    warm_praise_recently_used: warmRecentlyUsed,
    specific_acknowledgment_detected: specificAck,
    detected_momentum_generic: momentumGeneric,
    praise_policy_reason: reason,
    detected_praise_phrases: detected,
    detected_warm_praise_phrases: warmPhrases,
    blocked_reasons: [...new Set(blocked)],
    allowed_reasons: allowed,
    streak_or_comeback_evidence: streakEvidence,
  };
}

export function compactPraisePolicyMetadata(result: SmsPraisePolicyResult): Record<string, unknown> {
  return {
    earned_praise_allowed: result.earned_praise_allowed,
    praise_cooldown_active: result.praise_cooldown_active,
    praise_specificity_ok: result.praise_specificity_ok,
    warm_praise_recently_used: result.warm_praise_recently_used,
    specific_acknowledgment_detected: result.specific_acknowledgment_detected,
    detected_momentum_generic: result.detected_momentum_generic,
    praise_policy_reason: result.praise_policy_reason,
    praise_blocked_reason: result.blocked_reasons[0] ?? null,
    detected_praise_phrases: result.detected_praise_phrases,
    detected_warm_praise_phrases: result.detected_warm_praise_phrases,
    streak_or_comeback_evidence: result.streak_or_comeback_evidence,
  };
}

/** Apply earned praise policy to raw FVG hits; relabel or drop praise-governed reasons. */
export function applyEarnedPraisePolicyToVoiceBlockedReasons(
  rawReasons: string[],
  policy: SmsPraisePolicyResult
): string[] {
  const withoutPraiseGoverned = rawReasons.filter((r) => !PRAISE_POLICY_GOVERNED_FVG_REASONS.has(r));

  const policyOnlyBlocks = policy.blocked_reasons.filter(
    (r) => !PRAISE_POLICY_GOVERNED_FVG_REASONS.has(r)
  );

  if (policy.detected_praise_phrases.length === 0 && !policy.detected_momentum_generic) {
    return [...new Set(withoutPraiseGoverned)];
  }

  if (policy.blocked_reasons.length > 0) {
    return [...new Set([...withoutPraiseGoverned, ...policy.blocked_reasons])];
  }

  return [...new Set(withoutPraiseGoverned)];
}

export function buildSmsPraisePolicyArgsFromFinalVoiceGate(args: {
  proposedBody: string;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  latestInboundRaw?: string | null;
  contextPacket?: {
    effectiveAskText?: string | null;
    behaviorStatement?: string | null;
    latestInboundRaw?: string | null;
    latestOutcomeType?: string | null;
    todayCompleted?: boolean;
    proofSignal?: boolean;
  } | null;
  v3BrainMetadata?: Record<string, unknown> | null;
  laneKind?: SmsPraisePolicyLaneKind;
}): SmsPraisePolicyEvaluateArgs {
  const embedded = args.v3BrainMetadata?.praise_policy_context;
  if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
    return {
      ...(embedded as SmsPraisePolicyEvaluateArgs),
      body: args.proposedBody,
      praisePolicyContextFromLane: true,
    };
  }

  const pkt = args.contextPacket;
  const priorOutcome =
    pkt?.latestOutcomeType === "user_yes" || pkt?.todayCompleted === true ? "user_yes" : null;

  return {
    body: args.proposedBody,
    laneKind: args.laneKind ?? "daily",
    effectiveAsk: args.effectiveAsk ?? pkt?.effectiveAskText ?? null,
    behaviorStatement: args.behaviorStatement ?? pkt?.behaviorStatement ?? null,
    priorOutcome,
    proofOrMilestoneSignal: pkt?.proofSignal === true ? "proof_signal" : null,
    latestUserInbound: args.latestInboundRaw ?? pkt?.latestInboundRaw ?? null,
    praisePolicyContextFromLane: false,
  };
}

export function buildSmsPraisePolicyArgsFromDailyFacts(args: {
  body: string;
  routeKind: string;
  accountability: {
    prior_outcome: string | null;
    proof_or_milestone_signal: string | null;
    pending_plan_proof?: { active?: boolean } | null;
    yes_streak_14d?: number | null;
  };
  commitment: { effective_ask: string; behavior_statement: string };
  thread_memory: {
    latest_inbound_sms?: string | null;
    recent_exact_thread_72h?: RecentExactThread72hResult;
    relationship_memory_7d?: RelationshipMemory7dResult;
    last_5_coach_questions?: string[];
  };
}): SmsPraisePolicyEvaluateArgs {
  return {
    body: args.body,
    laneKind: "daily",
    routePurpose: args.routeKind,
    effectiveAsk: args.commitment.effective_ask,
    behaviorStatement: args.commitment.behavior_statement,
    priorOutcome: args.accountability.prior_outcome,
    proofOrMilestoneSignal: args.accountability.proof_or_milestone_signal,
    pendingPlanProofActive: args.accountability.pending_plan_proof?.active === true,
    yesStreak14d: args.accountability.yes_streak_14d ?? null,
    relationshipMemory7d: args.thread_memory.relationship_memory_7d ?? null,
    recentExactThread72h: args.thread_memory.recent_exact_thread_72h ?? null,
    latestUserInbound: args.thread_memory.latest_inbound_sms ?? null,
    recentCoachBodies: args.thread_memory.last_5_coach_questions ?? null,
    praisePolicyContextFromLane: true,
  };
}

export function buildSmsPraisePolicyArgsFromInboundFacts(args: {
  body: string;
  routePurpose: string;
  inbound_meaning: InboundMeaningFacts;
  commitment: { effective_ask: string; behavior_statement: string };
  thread: {
    coalesced_inbound_text?: string;
    memory_packet?: {
      recent_exact_thread_72h?: RecentExactThread72hResult;
      relationship_memory_7d?: RelationshipMemory7dResult;
      last_5_coach_questions?: string[];
    };
  };
  prior_outcome?: string | null;
  proof_or_milestone_signal?: string | null;
}): SmsPraisePolicyEvaluateArgs {
  const mp = args.thread.memory_packet;
  return {
    body: args.body,
    laneKind: "inbound",
    routePurpose: args.routePurpose,
    effectiveAsk: args.commitment.effective_ask,
    behaviorStatement: args.commitment.behavior_statement,
    priorOutcome: args.prior_outcome ?? null,
    proofOrMilestoneSignal: args.proof_or_milestone_signal ?? null,
    inboundMeaning: args.inbound_meaning,
    relationshipMemory7d: mp?.relationship_memory_7d ?? null,
    recentExactThread72h: mp?.recent_exact_thread_72h ?? null,
    latestUserInbound: args.thread.coalesced_inbound_text ?? null,
    recentCoachBodies: mp?.last_5_coach_questions ?? null,
    praisePolicyContextFromLane: true,
  };
}

export function buildSmsPraisePolicyArgsFromWeeklyFacts(args: {
  body: string;
  routePurpose: string;
  commitment: { effective_ask: string | null; behavior_statement: string | null };
  weekly_proof: {
    proof_moment_hints: string[];
    strong_week?: boolean | null;
    completed_count?: number | null;
  };
  thread: {
    recent_exact_thread_72h?: RecentExactThread72hResult | null;
    relationship_memory_7d?: RelationshipMemory7dResult | null;
    last_5_coach_questions?: string[] | null;
  };
}): SmsPraisePolicyEvaluateArgs {
  return {
    body: args.body,
    laneKind: "weekly",
    routePurpose: args.routePurpose,
    effectiveAsk: args.commitment.effective_ask,
    behaviorStatement: args.commitment.behavior_statement,
    weeklyProofHints: args.weekly_proof.proof_moment_hints,
    weeklyStrongWeek: args.weekly_proof.strong_week ?? null,
    weeklyCompletedCount: args.weekly_proof.completed_count ?? null,
    relationshipMemory7d: args.thread.relationship_memory_7d ?? null,
    recentExactThread72h: args.thread.recent_exact_thread_72h ?? null,
    recentCoachBodies: args.thread.last_5_coach_questions ?? null,
    praisePolicyContextFromLane: true,
  };
}

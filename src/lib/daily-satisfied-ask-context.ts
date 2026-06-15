/**
 * Read recent inbound satisfied-ask / do-not-repeat truth for daily SMS (no migration).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { hasFuturePlanIntentLanguage } from "@/lib/pending-plan-proof";

export type DailySatisfiedAskType =
  | "plan_detail"
  | "plan_confirmation"
  | "direct_answer"
  | "outcome_answer"
  | "reflection_answer"
  | "unknown";

export type DailySatisfiedAskContextSource =
  | "inbound_turn_telemetry"
  | "thread_projection"
  | "recent_exact_thread";

export type DailySatisfiedAskContext = {
  has_satisfied_recent_ask: boolean;
  satisfied_ask_type: DailySatisfiedAskType;
  do_not_repeat_asks: string[];
  evidence_preview: string | null;
  source: DailySatisfiedAskContextSource;
  occurred_at: string | null;
  last_ask_satisfied: "yes" | "no" | "unclear";
  stale_ask_risk: boolean;
  relationship_meaning: string | null;
  response_intent: string | null;
  prior_question_type: string | null;
  outcome_proof_eligible: boolean | null;
  persistence_note: string;
};

export type ResolveDailySatisfiedAskContextArgs = {
  eventsNewestFirst?: V2EventRowForAi[];
  latestOpenQuestion?: string | null;
  latestAnswerAfterOpenQuestion?: string | null;
  openQuestionPending?: boolean;
  doNotRepeatPhrases?: string[];
  lastInboundFullBody?: string | null;
  openQuestionExpectedAnswerType?: string | null;
};

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DNR = 6;

function parseStringArrayField(v: unknown, max = MAX_DNR): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asTrimmedString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

function mergeDoNotRepeat(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const t = raw.trim();
      if (t.length < 8) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t.slice(0, 160));
      if (out.length >= MAX_DNR) return out;
    }
  }
  return out;
}

function inferSatisfiedAskType(args: {
  priorQuestionType: string | null;
  relationshipMeaning: string | null;
  evidencePreview: string | null;
  openQuestionExpectedAnswerType: string | null;
  outcomeProofEligible: boolean | null;
}): DailySatisfiedAskType {
  const pt = args.priorQuestionType?.trim().toLowerCase() ?? "";
  if (pt === "plan_confirmation") return "plan_confirmation";
  if (pt === "outcome_check" || args.outcomeProofEligible === true) return "outcome_answer";

  const rm = args.relationshipMeaning?.trim().toLowerCase() ?? "";
  if (rm.includes("reflection") || rm === "reflective_share") return "reflection_answer";
  if (rm.includes("completion") || rm === "reported_completion") return "outcome_answer";
  if (rm.includes("plan") || rm === "plan_made") return "plan_detail";

  const ev = args.evidencePreview?.trim() ?? "";
  if (ev && hasFuturePlanIntentLanguage(ev)) return "plan_detail";
  if (/^yes\b/i.test(ev) && args.openQuestionExpectedAnswerType === "proposal_yes_no") {
    return "plan_confirmation";
  }
  if (ev.length >= 12) return "direct_answer";
  return "unknown";
}

function contextFromTelemetryEvent(
  e: V2EventRowForAi,
  payload: Record<string, unknown>
): DailySatisfiedAskContext | null {
  const lastAsk =
    payload.turn_understanding_last_ask_satisfied === "yes" ||
    payload.turn_understanding_last_ask_satisfied === "no" ||
    payload.turn_understanding_last_ask_satisfied === "unclear"
      ? (payload.turn_understanding_last_ask_satisfied as "yes" | "no" | "unclear")
      : "unclear";

  const dnr = mergeDoNotRepeat(parseStringArrayField(payload.do_not_repeat_asks), parseStringArrayField(
    payload.turn_understanding_failed_safe_do_not_repeat_asks
  ));

  const staleAskRisk = payload.turn_understanding_stale_ask_violation_detected === true || dnr.length > 0;
  const hasSatisfied = lastAsk === "yes" || (staleAskRisk && dnr.length > 0);

  if (!hasSatisfied && dnr.length === 0) return null;

  const evidencePreview =
    asTrimmedString(payload.raw_body_preview, 220) ??
    asTrimmedString(payload.message, 220) ??
    null;
  const priorQuestionType = asTrimmedString(payload.prior_question_type, 80);
  const relationshipMeaning = asTrimmedString(payload.turn_understanding_relationship_meaning, 120);
  const responseIntent = asTrimmedString(payload.turn_understanding_response_intent, 120);
  const outcomeProofEligible =
    typeof payload.outcome_proof_eligible === "boolean" ? payload.outcome_proof_eligible : null;

  const satisfiedAskType = inferSatisfiedAskType({
    priorQuestionType,
    relationshipMeaning,
    evidencePreview,
    openQuestionExpectedAnswerType: null,
    outcomeProofEligible,
  });

  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: satisfiedAskType,
    do_not_repeat_asks: dnr,
    evidence_preview: evidencePreview,
    source: "inbound_turn_telemetry",
    occurred_at: e.occurred_at,
    last_ask_satisfied: lastAsk === "yes" ? "yes" : lastAsk,
    stale_ask_risk: staleAskRisk || lastAsk === "yes",
    relationship_meaning: relationshipMeaning,
    response_intent: responseIntent,
    prior_question_type: priorQuestionType,
    outcome_proof_eligible: outcomeProofEligible,
    persistence_note:
      "Satisfied-ask context only — does not authorize proof, user_yes, or Victory claims without server outcome evidence.",
  };
}

function contextFromThreadProjection(args: ResolveDailySatisfiedAskContextArgs): DailySatisfiedAskContext | null {
  const answer = args.latestAnswerAfterOpenQuestion?.trim() ?? "";
  const question = args.latestOpenQuestion?.trim() ?? "";
  if (!answer || args.openQuestionPending === true) return null;

  const dnr = mergeDoNotRepeat(
    args.doNotRepeatPhrases,
    question ? [question] : undefined
  );
  if (dnr.length === 0 && !question) return null;

  const evidencePreview = asTrimmedString(args.lastInboundFullBody, 220) ?? asTrimmedString(answer, 220);
  const satisfiedAskType = inferSatisfiedAskType({
    priorQuestionType: null,
    relationshipMeaning: hasFuturePlanIntentLanguage(answer) ? "plan_made" : "answer_to_prior_question",
    evidencePreview,
    openQuestionExpectedAnswerType: args.openQuestionExpectedAnswerType ?? null,
    outcomeProofEligible: null,
  });

  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: satisfiedAskType,
    do_not_repeat_asks: dnr.length > 0 ? dnr : question ? [question.slice(0, 160)] : [],
    evidence_preview: evidencePreview,
    source: "thread_projection",
    occurred_at: null,
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    relationship_meaning: hasFuturePlanIntentLanguage(answer) ? "plan_made" : "answer_to_prior_question",
    response_intent: "acknowledge_prior_answer",
    prior_question_type: args.openQuestionExpectedAnswerType ?? null,
    outcome_proof_eligible: false,
    persistence_note:
      "Thread projection only — plan answers are not proof; do not claim completion without server outcome evidence.",
  };
}

function isRecentEnough(occurredAt: string | null | undefined, nowMs: number): boolean {
  if (!occurredAt) return true;
  const ms = Date.parse(occurredAt);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms <= MAX_AGE_MS;
}

/** Resolve the latest authoritative satisfied-ask context for daily outbound. */
export function resolveDailySatisfiedAskContext(
  args: ResolveDailySatisfiedAskContextArgs
): DailySatisfiedAskContext | null {
  const nowMs = Date.now();

  for (const e of args.eventsNewestFirst ?? []) {
    if (!isRecentEnough(e.occurred_at, nowMs)) break;
    const payload = e.payload_json ?? {};
    if (payload.inbound_turn_telemetry === true) {
      const ctx = contextFromTelemetryEvent(e, payload);
      if (ctx) return ctx;
    }
    const dnr = mergeDoNotRepeat(parseStringArrayField(payload.do_not_repeat_asks));
    const lastAsk = payload.turn_understanding_last_ask_satisfied;
    if (
      dnr.length > 0 &&
      (lastAsk === "yes" || payload.stale_ask_avoided === true || payload.stale_ask_risk === true)
    ) {
      const ctx = contextFromTelemetryEvent(e, payload);
      if (ctx) return ctx;
    }
  }

  const threadCtx = contextFromThreadProjection(args);
  if (threadCtx) return threadCtx;

  const inbound = args.lastInboundFullBody?.trim();
  if (inbound && inbound.length >= 12 && args.openQuestionPending === false) {
    return {
      has_satisfied_recent_ask: true,
      satisfied_ask_type: inferSatisfiedAskType({
        priorQuestionType: null,
        relationshipMeaning: hasFuturePlanIntentLanguage(inbound) ? "plan_made" : "answer_to_prior_question",
        evidencePreview: inbound.slice(0, 220),
        openQuestionExpectedAnswerType: args.openQuestionExpectedAnswerType ?? null,
        outcomeProofEligible: null,
      }),
      do_not_repeat_asks: mergeDoNotRepeat(
        args.doNotRepeatPhrases,
        args.latestOpenQuestion ? [args.latestOpenQuestion] : undefined
      ),
      evidence_preview: inbound.slice(0, 220),
      source: "recent_exact_thread",
      occurred_at: null,
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      relationship_meaning: hasFuturePlanIntentLanguage(inbound) ? "plan_made" : "answer_to_prior_question",
      response_intent: "acknowledge_prior_answer",
      prior_question_type: args.openQuestionExpectedAnswerType ?? null,
      outcome_proof_eligible: false,
      persistence_note:
        "Recent inbound text only — not server proof; do not claim user_yes or saved proof.",
    };
  }

  return null;
}

const PLAN_AFFIRMING_SATISFIED_ASK_TYPES = new Set<DailySatisfiedAskType>([
  "plan_confirmation",
  "plan_detail",
]);

/** True when satisfied-ask context indicates the user already affirmed a plan or timing. */
export function isPlanAffirmingDailySatisfiedAskContext(
  ctx: DailySatisfiedAskContext | null | undefined
): boolean {
  if (!ctx?.has_satisfied_recent_ask) return false;

  const priorQuestionType = ctx.prior_question_type?.trim().toLowerCase() ?? "";
  if (priorQuestionType === "outcome_check") return false;
  if (ctx.satisfied_ask_type === "outcome_answer") return false;

  if (PLAN_AFFIRMING_SATISFIED_ASK_TYPES.has(ctx.satisfied_ask_type)) return true;
  if (priorQuestionType === "plan_confirmation") return true;

  const relationshipMeaning = ctx.relationship_meaning?.trim().toLowerCase() ?? "";
  if (
    relationshipMeaning === "plan_made" ||
    relationshipMeaning === "answer_to_prior_question"
  ) {
    return true;
  }

  const evidence = ctx.evidence_preview?.trim() ?? "";
  return Boolean(evidence && hasFuturePlanIntentLanguage(evidence));
}

export type SameBaseRecommitSuppressionResult = {
  suppress: boolean;
  reason: string | null;
};

/**
 * Suppress same-base recommit_same contract_prompt when recent thread already affirms the plan.
 * Internal nextMove type may remain recommit_same; visible contract proposal should not fire.
 */
export function shouldSuppressSameBaseRecommitForSatisfiedPlan(args: {
  nextMoveType: string;
  satisfiedAskContext: DailySatisfiedAskContext | null | undefined;
  /** Same-base recommit proposals use the current/base behavior statement. */
  proposedBarText: string;
  baseBehaviorStatement: string;
}): SameBaseRecommitSuppressionResult {
  if (args.nextMoveType !== "recommit_same") {
    return { suppress: false, reason: null };
  }
  if (!isPlanAffirmingDailySatisfiedAskContext(args.satisfiedAskContext)) {
    return { suppress: false, reason: null };
  }

  const proposed = args.proposedBarText.trim();
  const base = args.baseBehaviorStatement.trim();
  if (!proposed || !base) {
    return { suppress: false, reason: null };
  }
  if (proposed.toLowerCase() !== base.toLowerCase()) {
    return { suppress: false, reason: null };
  }

  return {
    suppress: true,
    reason: "satisfied_plan_already_affirmed",
  };
}

export function slimDailySatisfiedAskContextForTelemetry(
  ctx: DailySatisfiedAskContext | null | undefined
): Record<string, unknown> | null {
  if (!ctx?.has_satisfied_recent_ask) return null;
  return {
    has_satisfied_recent_ask: ctx.has_satisfied_recent_ask,
    satisfied_ask_type: ctx.satisfied_ask_type,
    do_not_repeat_asks_count: ctx.do_not_repeat_asks.length,
    daily_satisfied_ask_context_source: ctx.source,
    evidence_preview: ctx.evidence_preview,
    occurred_at: ctx.occurred_at,
    last_ask_satisfied: ctx.last_ask_satisfied,
    stale_ask_risk: ctx.stale_ask_risk,
    prior_question_type: ctx.prior_question_type,
    outcome_proof_eligible: ctx.outcome_proof_eligible,
  };
}

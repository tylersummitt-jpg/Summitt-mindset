/**
 * Lightweight derived fact: user stated a dated plan; outcome not yet proven.
 * No DB migration — runtime only for daily V3 facts + guards.
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  deriveTimingAnchorMemory,
  normalizeAnchorKey,
  type TimingAnchorMemory,
} from "@/lib/timing-anchor-memory";
import {
  inboundHasExplicitCompletionClause,
  splitInboundClauses,
} from "@/lib/inbound-short-answer-clauses";
import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";

export type PendingPlanProofRecurrenceConfidence = "unknown" | "low";

/** Active pending plan proof context (facts JSON only — not user-visible labels). */
export type PendingPlanProofFact = {
  active: true;
  plan_summary_hint: string;
  anchor_phrase_hint: string | null;
  /** Normalized match key (e.g. brooke|workout); not a person graph. */
  anchor_key: string | null;
  plan_for_day_key: string;
  source_answer_preview: string;
  recurrence_confidence: PendingPlanProofRecurrenceConfidence;
  outcome_known: false;
};

const OUTCOME_EVENT_TYPES = new Set(["user_yes", "user_no", "user_partial"]);

export type DerivePendingPlanProofArgs = {
  accountabilityDayKey: string;
  timezone: string;
  latestOpenQuestion: string | null;
  latestAnswerAfterOpenQuestion: string | null;
  openQuestionAnsweredAt?: string | null;
  openQuestionPending?: boolean;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  recentExactThreadText?: string | null;
  userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
  eventsNewestFirst?: V2EventRowForAi[];
};

function normWords(text: string, minLen = 4): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= minLen);
}

export function hasFuturePlanIntentLanguage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(i'?ll|i will|planned to|plan to|going to|gonna)\b/i.test(t)) return true;
  if (/\bmake it happen\b/i.test(t) && /\b(today|tomorrow|after|when)\b/i.test(t)) return true;
  if (/\btoday after\b/i.test(t)) return true;
  if (/\bafter\s+.{2,60}\b(gets back|returns|workout|meeting|call|shift|leaves)\b/i.test(t)) return true;
  return false;
}

/** Negation, plan, partial, wish, or uncertainty — not relationship completion. */
export function extractCompletionDisqualifiers(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const found: string[] = [];
  const rules: Array<{ re: RegExp; label: string }> = [
    { re: /\b(didn'?t|did not|didnt|never|not done|haven'?t|have not)\b/i, label: "negation" },
    { re: /\b(almost|tried to|attempted to|started to|working on|not finished|partially|halfway)\b/i, label: "partial_attempt" },
    { re: /\b(made a plan|planned to|plan to|going to|gonna|i'?ll|i will|intend to|want to)\b/i, label: "plan_intent" },
    { re: /\b(wish i|wished i|thought about|think about|thinking about|considered)\b/i, label: "wish_or_thinking" },
    { re: /\b(maybe|not sure|i guess|i think)\b/i, label: "uncertainty" },
    { re: /\?\s*$/i, label: "trailing_question" },
  ];
  for (const { re, label } of rules) {
    if (re.test(t) && !found.includes(label)) found.push(label);
  }
  if (/\b(i did|i made)\s+a\s+plan\b/i.test(t) && !found.includes("plan_intent")) {
    found.push("plan_intent");
  }
  return found;
}

export function inferTemporalScopeFromInbound(text: string): "today" | "yesterday" | "past" | "future" | "unclear" {
  const t = text.trim().toLowerCase();
  if (!t) return "unclear";
  if (/\byesterday\b|\blast night\b|\bthe other day\b/i.test(t)) return "yesterday";
  if (/\b(last week|last month|earlier|already|before)\b/i.test(t)) return "past";
  if (/\b(tomorrow|tonight|later|next week)\b/i.test(t) && /\b(will|going to|gonna|'ll|plan)\b/i.test(t)) {
    return "future";
  }
  if (/\bfor today\b|\btoday\b/i.test(t)) return "today";
  return "unclear";
}

function isReportedCompletionClauseCandidate(clause: string): boolean {
  const t = clause.trim();
  if (!t) return false;
  if (hasFuturePlanIntentLanguage(t) && !/\b(got my|got\s+\d+|completed|finished|did it)\b/i.test(t)) {
    return false;
  }
  if (extractCompletionDisqualifiers(t).length > 0) return false;
  if (/\b(i did|i got it done|finished|completed|it happened|done[, ]+yes|yes[, ]+done|made it happen)\b/i.test(t)) {
    return true;
  }
  if (/\b(i did|i made|i completed|i finished)\s+(the\s+|my\s+|at\s+least\s+)?[\w',-]+/i.test(t)) {
    if (/\b(i did|i made)\s+a\s+plan\b/i.test(t)) return false;
    return true;
  }
  if (/\b(i\s+)?got\s+(it\s+)?done\b/i.test(t)) return true;
  if (/\b(hit my|reached|got my)\s+[\w',-]+\s+(goal|steps|hours|calls)\b/i.test(t)) return true;
  if (/\b(got\s+my\s+[^.!?]{2,48}\s+in\s+today)\b/i.test(t)) return true;
  if (/\b(i got|got)\s+(my\s+)?(two|2|\d+)\s+hours?\s+in\b/i.test(t)) return true;
  if (/\b(i\s+)?did\s+the\s+\w+/i.test(t)) return true;
  if (/\b(i\s+)?did\s+it\b/i.test(t) && !/\b(almost|wish|think)\b/i.test(t)) return true;
  return false;
}

/**
 * Hardened relationship completion candidate — not sufficient alone for user_yes persist.
 * Requires positive completion shape and no disqualifiers. Clause-aware for compound messages.
 */
export function isReportedCompletionRelationshipCandidate(
  text: string,
  shortAnswerContext?: ShortAnswerContextAuthority | null
): boolean {
  const t = text.trim();
  if (!t) return false;

  if (/^\s*(yes|done)\s*$/i.test(t)) {
    return shortAnswerContext?.outcome_proof_eligible === true;
  }

  if (inboundHasExplicitCompletionClause(t)) return true;

  for (const clause of splitInboundClauses(t)) {
    if (isReportedCompletionClauseCandidate(clause)) return true;
  }

  if (hasFuturePlanIntentLanguage(t)) return false;
  if (extractCompletionDisqualifiers(t).length > 0) return false;
  return isReportedCompletionClauseCandidate(t);
}

/** User message reads as reported completion, not a forward plan (shared helper — uses hardened candidate). */
export function looksLikeReportedCompletion(text: string): boolean {
  return isReportedCompletionRelationshipCandidate(text);
}

export function extractAnchorPhraseHint(answer: string): string | null {
  const t = answer.trim();
  const m =
    t.match(/\b(after\s+[^,.!?]{4,72}(?:workout|gets back|returns|meeting|call|shift)[^,.!?]{0,24})/i) ??
    t.match(/\b(after\s+[^,.!?]{6,56})/i);
  if (!m?.[1]) return null;
  return m[1].trim().slice(0, 80);
}

function answerTiedToCurrentGoal(args: {
  answer: string;
  openQuestion: string | null;
  effectiveAsk: string;
  behaviorStatement: string;
}): boolean {
  const openQ = args.openQuestion?.trim() ?? "";
  if (
    openQ &&
    /\b(action|distribution|hour|hours|commitment|did you|what will|ensure you|spend|block|protect)\b/i.test(
      openQ
    )
  ) {
    return true;
  }
  const askWords = [...new Set([...normWords(args.effectiveAsk), ...normWords(args.behaviorStatement)])];
  if (!askWords.length) return true;
  const answerSet = new Set(normWords(args.answer));
  return askWords.some((w) => answerSet.has(w));
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shiftDateKey(dayKey: string, timezone: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split("-").map((x) => parseInt(x, 10));
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return getDateKeyInTimezone(base, timezone);
}

function inferPlanForDayKey(args: {
  answer: string;
  answeredAtIso: string | null;
  timezone: string;
  accountabilityDayKey: string;
}): string | null {
  const answeredDay = args.answeredAtIso
    ? getDateKeyInTimezone(new Date(args.answeredAtIso), args.timezone)
    : null;
  const a = args.answer.toLowerCase();
  if (/\btoday\b/i.test(a) && answeredDay) {
    return answeredDay;
  }
  if (/\blast night\b/i.test(a) && answeredDay) {
    return shiftDateKey(answeredDay, args.timezone, -1);
  }
  if (/\btomorrow\b/i.test(a) && answeredDay) {
    return shiftDateKey(answeredDay, args.timezone, 1);
  }
  if (answeredDay) return answeredDay;
  return shiftDateKey(args.accountabilityDayKey, args.timezone, -1);
}

function hasOutcomeEventAfter(events: V2EventRowForAi[] | undefined, afterMs: number): boolean {
  if (!events?.length || afterMs <= 0) return false;
  for (const e of events) {
    const t = parseIsoMs(e.occurred_at);
    if (t <= afterMs) continue;
    if (OUTCOME_EVENT_TYPES.has(e.event_type)) return true;
  }
  return false;
}

function hasLaterUserCompletionAfterPlan(args: {
  planAnswer: string;
  planAnswerAtMs: number;
  userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
}): boolean {
  const planNorm = args.planAnswer.trim().toLowerCase();
  for (const row of args.userAnswersNewestFirst ?? []) {
    const text = row.text?.trim() ?? "";
    if (!text || text.toLowerCase() === planNorm) continue;
    const at = parseIsoMs(row.answered_at ?? null);
    if (args.planAnswerAtMs > 0 && at > 0 && at <= args.planAnswerAtMs) continue;
    if (looksLikeReportedCompletion(text)) return true;
  }
  return false;
}

/**
 * Derive pending plan proof when a recent plan answer is unverified and tied to a prior day.
 */
export function derivePendingPlanProof(args: DerivePendingPlanProofArgs): PendingPlanProofFact | null {
  const answer = args.latestAnswerAfterOpenQuestion?.trim() ?? "";
  if (!answer || args.openQuestionPending === true) return null;
  if (!hasFuturePlanIntentLanguage(answer)) return null;
  if (looksLikeReportedCompletion(answer)) return null;

  const effectiveAsk = args.effectiveAsk?.trim() ?? "";
  const behaviorStatement = args.behaviorStatement?.trim() ?? "";
  if (
    !answerTiedToCurrentGoal({
      answer,
      openQuestion: args.latestOpenQuestion,
      effectiveAsk,
      behaviorStatement,
    })
  ) {
    return null;
  }

  const planForDayKey = inferPlanForDayKey({
    answer,
    answeredAtIso: args.openQuestionAnsweredAt ?? null,
    timezone: args.timezone,
    accountabilityDayKey: args.accountabilityDayKey,
  });
  if (!planForDayKey || planForDayKey >= args.accountabilityDayKey) return null;

  const planAnswerAtMs = parseIsoMs(args.openQuestionAnsweredAt ?? null);
  if (hasOutcomeEventAfter(args.eventsNewestFirst, planAnswerAtMs)) return null;
  if (
    hasLaterUserCompletionAfterPlan({
      planAnswer: answer,
      planAnswerAtMs,
      userAnswersNewestFirst: args.userAnswersNewestFirst,
    })
  ) {
    return null;
  }

  const anchor = extractAnchorPhraseHint(answer);
  const anchor_key = anchor ? normalizeAnchorKey(anchor) : null;
  return {
    active: true,
    plan_summary_hint: answer.length > 140 ? `${answer.slice(0, 139)}…` : answer,
    anchor_phrase_hint: anchor,
    anchor_key,
    plan_for_day_key: planForDayKey,
    source_answer_preview: answer.length > 220 ? `${answer.slice(0, 219)}…` : answer,
    recurrence_confidence: "unknown",
    outcome_known: false,
  };
}

/** Daily lane: how to treat open-question answers vs pending plan proof (facts JSON holds truth). */
export function buildDailyOpenQuestionAnswerPriorityGuidance(): string {
  return `
OPEN QUESTION / LATEST ANSWER PRIORITY (read accountability.pending_plan_proof and accountability.timing_anchor_memory in facts):
1. If accountability.pending_plan_proof.active is true: the prior user reply was a plan/intention, not proof. Close that loop BEFORE new tactical advice. Ask whether the planned action happened (done, partial, or missed) — NOT whether to plan/schedule/calendar it again.
   - If the user already gave a concrete plan detail (who/when/what), do NOT ask them to plan or schedule it again.
   - Good outcome-close: "Did the noon call with Bond happen, or did something get in the way?" / "Did the planned block happen?" / "What happened with the plan today?"
   - Bad (stale re-plan): "Are you ready to put it on the calendar?" / "How does this plan feel for the rest of the week?" / "Should we get family time on the calendar?"
   - Do not re-ask the same open accountability question as if unanswered. Do not praise completion, focus, follow-through, or being back on track unless proof exists in facts.
2. Else if accountability.pending_plan_proof is inactive and facts show a clear outcome/proof for the prior check (prior_outcome, user yes/no/partial, or completion-shaped answer): you may move forward from that answer/outcome.
3. Else if thread_memory.latest_answer_after_open_question exists but reads as a forward plan (future intent, timing window, "I will/I'll…") and outcome is still unknown: do not treat the answer as proof. Apply timing_anchor_memory confidence rules if active. Prefer truth-closing over new advice when uncertain.
4. Else if thread_memory.open_question_pending is false and latest_answer_after_open_question is set: you may move forward from that answer — do not ask that open question again.
- A stated plan is not completion. Intention is not proof.`;
}

export function buildPendingPlanProofLaneGuardrails(pending: PendingPlanProofFact | null | undefined): string {
  if (!pending?.active) return "";
  const anchorNote = pending.anchor_phrase_hint
    ? ` Timing detail from their plan (apply timing_anchor_memory confidence — do NOT assume daily recurrence): ${JSON.stringify(pending.anchor_phrase_hint)}.`
    : "";
  return `
PENDING PLAN PROOF (facts only — do not say these labels in SMS):
- accountability.pending_plan_proof.active is true: the prior user reply was a plan/intention, not proof.
- suggested_coaching_move is close_prior_plan_loop: close the loop before giving new advice or reusing today's plan.
- Ask for the outcome of the prior plan in natural language (done, partial, or missed) for ${JSON.stringify(pending.plan_for_day_key)}.
- If the user already gave a concrete plan detail in facts, ask whether that planned action happened or what got in the way — do NOT ask them to schedule/plan/calendar it again.
- You may reference a timing detail only as a dated or tentative window; use accountability.timing_anchor_memory.confidence_level if present.
- Do NOT treat the timing anchor as a recurring daily habit unless timing_anchor_memory supports it.
- Do NOT praise focus, completion, being back on track, or follow-through unless proof exists in facts.
- Do NOT instruct them to dive into the block today as if the prior day is already handled unless you first ask what happened.${anchorNote}`;
}

const UNEARNED_PRAISE_PATTERNS: Array<[string, RegExp]> = [
  ["unearned_focus_praise", /\b(great|nice)\s+to\s+see\s+you\s+focused\b/i],
  ["unearned_focus_praise", /\bit'?s\s+great\s+to\s+see\s+you\s+focused\b/i],
  ["unearned_back_on_track", /\bback on track\b/i],
  ["unearned_followed_through", /\byou\s+followed\s+through\b/i],
  ["unearned_made_it_happen", /\byou\s+made\s+it\s+happen\b/i],
  ["unearned_nice_work", /\bnice\s+work\b/i],
];

const ALLOWED_WARMTH_PATTERNS: RegExp[] = [
  /\bgood\s+to\s+see\s+you\s+back\b/i,
  /\bgood\s+to\s+hear\s+from\s+you\b/i,
  /\b(i'?m\s+)?glad\s+you\s+answered\b/i,
  /\bgood\s+to\s+see\s+you\b/i,
];

export function detectPendingPlanProofVoiceViolations(
  body: string,
  pending: PendingPlanProofFact | null | undefined
): string[] {
  if (!pending?.active) return [];
  const t = body.trim();
  if (!t) return [];
  const hits: string[] = [];

  for (const [name, re] of UNEARNED_PRAISE_PATTERNS) {
    if (!re.test(t)) continue;
    if (ALLOWED_WARMTH_PATTERNS.some((allow) => allow.test(t) && name === "unearned_focus_praise")) {
      continue;
    }
    if (!hits.includes(name)) hits.push(name);
  }

  return hits;
}

export const PLAN_PROOF_ELIGIBLE_ROUTE_KINDS = new Set([
  "main_active_accountability",
  "low_pressure_reactivation",
]);

export type DailyFactsCoreForPendingPlanEnrich = {
  route_kind: string;
  accountability_day_key: string;
  user: { timezone: string };
  commitment: { effective_ask: string; behavior_statement: string };
  thread_memory: {
    latest_open_question?: string | null;
    latest_answer_after_open_question?: string | null;
    open_question_answered_at?: string | null;
    open_question_pending?: boolean;
    recent_exact_thread_text?: string | null;
  };
  accountability: Record<string, unknown> & {
    pending_plan_proof?: PendingPlanProofFact | null;
    timing_anchor_memory?: TimingAnchorMemory | null;
  };
};

/** Attach derived pending_plan_proof + timing_anchor_memory to daily facts when eligible. */
export function enrichDailyFactsCoreWithPendingPlanProof<T extends DailyFactsCoreForPendingPlanEnrich>(
  facts: T,
  ctx: {
    eventsNewestFirst: V2EventRowForAi[];
    openQuestionAnsweredAt?: string | null;
    userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
  }
): T {
  if (!PLAN_PROOF_ELIGIBLE_ROUTE_KINDS.has(facts.route_kind)) return facts;
  const tm = facts.thread_memory;
  const pending = derivePendingPlanProof({
    accountabilityDayKey: facts.accountability_day_key,
    timezone: facts.user.timezone,
    latestOpenQuestion: tm.latest_open_question ?? null,
    latestAnswerAfterOpenQuestion: tm.latest_answer_after_open_question ?? null,
    openQuestionAnsweredAt: ctx.openQuestionAnsweredAt ?? tm.open_question_answered_at ?? null,
    openQuestionPending: tm.open_question_pending,
    effectiveAsk: facts.commitment.effective_ask,
    behaviorStatement: facts.commitment.behavior_statement,
    recentExactThreadText: tm.recent_exact_thread_text ?? null,
    userAnswersNewestFirst: ctx.userAnswersNewestFirst,
    eventsNewestFirst: ctx.eventsNewestFirst,
  });
  const timing_anchor_memory = deriveTimingAnchorMemory({
    latestAnswerAfterOpenQuestion: tm.latest_answer_after_open_question ?? null,
    recentExactThreadText: tm.recent_exact_thread_text ?? null,
    userAnswersNewestFirst: ctx.userAnswersNewestFirst,
    pendingPlanProof: pending,
    recentEvents: ctx.eventsNewestFirst,
    timezone: facts.user.timezone,
    openQuestionAnsweredAt: ctx.openQuestionAnsweredAt ?? tm.open_question_answered_at ?? null,
  });
  return {
    ...facts,
    accountability: {
      ...facts.accountability,
      ...(pending ? { pending_plan_proof: pending } : {}),
      timing_anchor_memory,
    },
  };
}

export function buildPendingPlanProofVoiceRepairInstruction(pending: PendingPlanProofFact): string {
  return [
    "The user had a stated plan whose outcome is still unknown.",
    "Rewrite to close that loop first: ask whether the planned action happened (done, partial, or missed).",
    "Do not praise focus or completion. Do not assume a timing detail repeats every day.",
    "Natural warmth is fine; unearned proof language is not.",
    pending.anchor_phrase_hint
      ? `Timing detail (uncertain recurrence): ${JSON.stringify(pending.anchor_phrase_hint)}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

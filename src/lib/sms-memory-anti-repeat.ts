/**
 * M2B-5 — Deterministic SMS memory anti-repeat detection + OpenAI repair orchestration.
 */

import {
  hasFuturePlanIntentLanguage,
  looksLikeReportedCompletion,
} from "@/lib/pending-plan-proof";
import {
  type MemoryRepeatRepairContext,
  type SmsMemoryRepeatRepairStrategy,
  SMS_MEMORY_REPEAT_REPAIR_STRATEGIES,
} from "@/lib/sms-memory-repeat-repair-types";
import { isClosePriorPlanLoopOutcomeQuestion } from "@/lib/timing-anchor-memory";
import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

export {
  SMS_MEMORY_REPEAT_REPAIR_STRATEGIES,
  type MemoryRepeatRepairContext,
  type SmsMemoryRepeatRepairStrategy,
} from "@/lib/sms-memory-repeat-repair-types";

export const STRATEGY_EXAMPLE_SMS: Record<
  SmsMemoryRepeatRepairStrategy,
  readonly [string, string]
> = {
  outcome_check: [
    "What actually happened with the block today?",
    "Give me the honest status on the distribution block.",
  ],
  binary_truth_check: [
    "Protected, partial, or missed?",
    "Did you follow through today — yes, partial, or not yet?",
  ],
  reset_question: [
    "Do we need to reset the window?",
    "Is it time to reset the plan for today?",
  ],
  barrier_check: [
    "What got in the way?",
    "What pulled you off the block?",
  ],
  next_first_step: [
    "What is the first move when the block starts?",
    "What's the first thing you do when it's time to follow through?",
  ],
  proof_check: [
    "What evidence do you have that you followed through?",
    "What actually happened when it was time to execute?",
  ],
  identity_tie_back: [
    "What would the standard require here?",
    "What does holding the line look like for you today?",
  ],
};

const REPAIR_STRATEGY_ALTERNATE_CHAIN: readonly SmsMemoryRepeatRepairStrategy[] =
  SMS_MEMORY_REPEAT_REPAIR_STRATEGIES;

/** Telemetry: memory repeat repair uses fresh-angle coaching move shift (not legacy paraphrase repair). */
export const SMS_MEMORY_REPEAT_REPAIR_SYSTEM = "fresh_angle_v1";

export type SmsMemoryRepeatViolationReason =
  | "repeated_recent_question"
  | "repeated_answered_open_question"
  | "repeated_do_not_repeat_phrase"
  | null;

export type SmsMemoryRepeatViolation = {
  hasViolation: boolean;
  repeatedPhrases: string[];
  repeatedQuestion: string | null;
  reason: SmsMemoryRepeatViolationReason;
  /** Set when a repeat would have fired but close-prior-plan-loop outcome exemption applied. */
  closeLoopExemptionApplied?: boolean;
};

const MIN_PHRASE_CHARS = 12;
const MIN_QUESTION_OVERLAP_CHARS = 18;

const COMPLIANCE_PHRASE_PATTERNS = [
  /\breply\s+stop\b/i,
  /\breply\s+help\b/i,
  /\btext\s+stop\b/i,
  /\btext\s+help\b/i,
  /\bunsubscribe\b/i,
  /\bopt\s*out\b/i,
];

const ACKNOWLEDGMENT_PREFIXES = [
  /^you'?re\s+right\b/i,
  /^you\s+are\s+right\b/i,
  /^got\s+it\b/i,
  /^thanks\s+for\b/i,
  /^thank\s+you\s+for\b/i,
  /^i\s+hear\s+you\b/i,
  /^makes\s+sense\b/i,
  /^understood\b/i,
];

export function normalizeSmsMemoryRepeatText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\breply\s+stop[\s\S]*$/i, "")
    .replace(/\breply\s+help[\s\S]*$/i, "")
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isComplianceOrTinyPhrase(phrase: string): boolean {
  const p = phrase.trim();
  if (p.length < MIN_PHRASE_CHARS) return true;
  if (COMPLIANCE_PHRASE_PATTERNS.some((re) => re.test(p))) return true;
  return false;
}

function coachQuestionTextsFromEntries(entries: Array<{ text?: string } | string> | undefined): string[] {
  if (!entries?.length) return [];
  const out: string[] = [];
  for (const e of entries) {
    const t = typeof e === "string" ? e.trim() : typeof e?.text === "string" ? e.text.trim() : "";
    if (t) out.push(t);
  }
  return out;
}

export function extractQuestionClausesFromBody(body: string): string[] {
  const stripped = body
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
  const clauses = stripped.match(/[^?!.]+[?]/g) ?? [];
  if (clauses.length) return clauses.map((c) => c.trim()).filter(Boolean);
  if (/\?/.test(stripped)) return [stripped];
  return [];
}

function wordOverlapRatio(a: string, b: string): number {
  const aWords = normalizeSmsMemoryRepeatText(a)
    .split(" ")
    .filter((w) => w.length > 3);
  const bWords = new Set(
    normalizeSmsMemoryRepeatText(b)
      .split(" ")
      .filter((w) => w.length > 3)
  );
  if (!aWords.length || !bWords.size) return 0;
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap += 1;
  return overlap / aWords.length;
}

function isProtectedByRequiredVerbatim(candidateNorm: string, required: string[]): boolean {
  for (const rv of required) {
    const rvn = normalizeSmsMemoryRepeatText(rv);
    if (rvn.length >= MIN_PHRASE_CHARS && candidateNorm.includes(rvn)) return true;
  }
  return false;
}

function phraseAppearsInCandidate(candidateNorm: string, phrase: string): boolean {
  const pn = normalizeSmsMemoryRepeatText(phrase);
  if (pn.length < MIN_PHRASE_CHARS) return false;
  if (candidateNorm.includes(pn)) return true;
  if (pn.length >= MIN_QUESTION_OVERLAP_CHARS && wordOverlapRatio(candidateNorm, pn) >= 0.45) {
    return /\?/.test(candidateNorm) || /\b(what|when|which|who|how|tell me|did you)\b/i.test(candidateNorm);
  }
  return false;
}

export function isNearExactDuplicateSms(a: string, b: string): boolean {
  const an = normalizeSmsMemoryRepeatText(a);
  const bn = normalizeSmsMemoryRepeatText(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  if (an.length >= 16 && bn.length >= 16) {
    const overlap = wordOverlapRatio(an, bn);
    if (overlap >= 0.92) return true;
    const shorter = an.length <= bn.length ? an : bn;
    const longer = an.length > bn.length ? an : bn;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.85) return true;
  }
  return false;
}

function latestAnswerIsPlanNotProof(latestAnswer: string | null | undefined): boolean {
  const t = latestAnswer?.trim() ?? "";
  if (!t) return false;
  if (looksLikeReportedCompletion(t)) return false;
  return hasFuturePlanIntentLanguage(t);
}

export function shouldApplyClosePriorPlanLoopAntiRepeatExemption(args: {
  candidateBody: string;
  pendingPlanProofActive?: boolean;
  suggestedCoachingMove?: string | null;
  latestAnswerText?: string | null;
  lastOutboundFullBody?: string | null;
}): boolean {
  const closeLoopContext =
    args.pendingPlanProofActive === true || args.suggestedCoachingMove === "close_prior_plan_loop";
  if (!closeLoopContext) return false;
  if (!latestAnswerIsPlanNotProof(args.latestAnswerText)) return false;
  if (!isClosePriorPlanLoopOutcomeQuestion(args.candidateBody)) return false;
  const lastOut = args.lastOutboundFullBody?.trim();
  if (lastOut && isNearExactDuplicateSms(args.candidateBody, lastOut)) return false;
  return true;
}

function isAcknowledgmentWithoutReask(candidate: string, priorQuestion: string): boolean {
  const t = candidate.trim();
  if (/\?/.test(t)) return false;
  if (!ACKNOWLEDGMENT_PREFIXES.some((re) => re.test(t))) return false;
  const pq = normalizeSmsMemoryRepeatText(priorQuestion);
  const cn = normalizeSmsMemoryRepeatText(t);
  if (pq.length >= MIN_PHRASE_CHARS && cn.includes(pq.slice(0, Math.min(48, pq.length)))) {
    return true;
  }
  return wordOverlapRatio(t, priorQuestion) >= 0.35 && !/\b(what|when|which|who|how)\b/i.test(t);
}

export function detectSmsMemoryRepeatViolation(args: {
  candidateBody: string;
  lastCoachQuestions?: Array<{ text?: string } | string>;
  doNotRepeatPhrases?: string[];
  answeredOpenQuestion?: string | null;
  latestAnswerText?: string | null;
  requiredVerbatimSubstrings?: string[];
  routePurpose?: string | null;
  pendingPlanProofActive?: boolean;
  suggestedCoachingMove?: string | null;
  lastOutboundFullBody?: string | null;
}): SmsMemoryRepeatViolation {
  const candidate = args.candidateBody.trim();
  if (!candidate) {
    return { hasViolation: false, repeatedPhrases: [], repeatedQuestion: null, reason: null };
  }

  const candidateNorm = normalizeSmsMemoryRepeatText(candidate);
  const required = (args.requiredVerbatimSubstrings ?? []).filter((s) => s.trim().length > 0);

  if (required.length > 0 && isProtectedByRequiredVerbatim(candidateNorm, required)) {
    const onlyBinding =
      required.some((rv) => candidate.includes(rv.trim())) &&
      !extractQuestionClausesFromBody(candidate).some((q) => {
        const qn = normalizeSmsMemoryRepeatText(q);
        return !required.some((rv) => normalizeSmsMemoryRepeatText(rv).includes(qn) || qn.includes(normalizeSmsMemoryRepeatText(rv)));
      });
    if (onlyBinding) {
      return { hasViolation: false, repeatedPhrases: [], repeatedQuestion: null, reason: null };
    }
  }

  const repeatedPhrases: string[] = [];
  let repeatedQuestion: string | null = null;
  let reason: SmsMemoryRepeatViolationReason = null;
  let closeLoopExemptionApplied = false;

  const coachQs = coachQuestionTextsFromEntries(args.lastCoachQuestions);
  const answeredQ = args.answeredOpenQuestion?.trim() ?? null;
  const latestAnswer = args.latestAnswerText?.trim() ?? null;

  const closeLoopExemption = shouldApplyClosePriorPlanLoopAntiRepeatExemption({
    candidateBody: candidate,
    pendingPlanProofActive: args.pendingPlanProofActive,
    suggestedCoachingMove: args.suggestedCoachingMove,
    latestAnswerText: latestAnswer,
    lastOutboundFullBody: args.lastOutboundFullBody,
  });

  if (answeredQ && latestAnswer) {
    const clauses = extractQuestionClausesFromBody(candidate);
    const targets = clauses.length ? clauses : [candidate];
    for (const clause of targets) {
      if (isAcknowledgmentWithoutReask(candidate, answeredQ)) continue;
      if (phraseAppearsInCandidate(normalizeSmsMemoryRepeatText(clause), answeredQ)) {
        if (closeLoopExemption) {
          closeLoopExemptionApplied = true;
          continue;
        }
        repeatedQuestion = answeredQ;
        reason = "repeated_answered_open_question";
        repeatedPhrases.push(answeredQ.slice(0, 280));
        break;
      }
    }
  }

  if (!reason) {
    for (const q of coachQs) {
      if (isComplianceOrTinyPhrase(q)) continue;
      if (required.some((rv) => normalizeSmsMemoryRepeatText(q).includes(normalizeSmsMemoryRepeatText(rv)))) {
        continue;
      }
      if (isAcknowledgmentWithoutReask(candidate, q)) continue;
      if (phraseAppearsInCandidate(candidateNorm, q)) {
        if (closeLoopExemption) {
          closeLoopExemptionApplied = true;
          continue;
        }
        repeatedQuestion = q;
        reason = "repeated_recent_question";
        repeatedPhrases.push(q.slice(0, 280));
        break;
      }
    }
  }

  if (!reason) {
    for (const phrase of args.doNotRepeatPhrases ?? []) {
      const p = phrase.trim();
      if (isComplianceOrTinyPhrase(p)) continue;
      if (required.some((rv) => normalizeSmsMemoryRepeatText(p).includes(normalizeSmsMemoryRepeatText(rv)))) {
        continue;
      }
      if (phraseAppearsInCandidate(candidateNorm, p)) {
        reason = "repeated_do_not_repeat_phrase";
        repeatedPhrases.push(p.slice(0, 280));
        if (!repeatedQuestion && p.includes("?")) repeatedQuestion = p;
      }
    }
  }

  const appliedFlag =
    closeLoopExemptionApplied || (closeLoopExemption && reason == null);

  return {
    hasViolation: reason != null,
    repeatedPhrases: [...new Set(repeatedPhrases)],
    repeatedQuestion,
    reason,
    ...(appliedFlag ? { closeLoopExemptionApplied: true } : {}),
  };
}

/** True when OpenAI lane repair is for memory anti-repeat (not generic voice compress). */
export function isMemoryRepeatRepairBlockedReason(blockedReasons: string[]): boolean {
  return blockedReasons.some((r) => r === "memory_repeat_question" || /\bmemory_repeat\b/i.test(r));
}

function extractAccountabilityPurposeFromFactsJson(factsJson: unknown): string | null {
  if (factsJson == null || typeof factsJson !== "object") return null;
  const f = factsJson as Record<string, unknown>;
  const commitment = f.commitment;
  const accountability = f.accountability;
  const pick = (obj: unknown, key: string): string | null => {
    if (obj == null || typeof obj !== "object") return null;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return (
    pick(commitment, "behavior_statement") ??
    pick(commitment, "effective_ask") ??
    pick(accountability, "behavior_statement") ??
    pick(accountability, "base_behavior_statement") ??
    null
  );
}

function extractPriorOutboundFullBodyFromFactsJson(
  factsJson: unknown,
  detectInput: Parameters<typeof detectSmsMemoryRepeatViolation>[0]
): string | null {
  const fromDetect = detectInput.lastOutboundFullBody?.trim();
  if (fromDetect) return fromDetect;
  if (factsJson == null || typeof factsJson !== "object") return null;
  const f = factsJson as Record<string, unknown>;
  const threadMemory = f.thread_memory;
  if (threadMemory != null && typeof threadMemory === "object") {
    const tm = threadMemory as Record<string, unknown>;
    const full = tm.last_outbound_full_body;
    if (typeof full === "string" && full.trim()) return full.trim();
    const latest = tm.latest_outbound_sms;
    if (typeof latest === "string" && latest.trim()) return latest.trim();
  }
  const thread = f.thread;
  if (thread != null && typeof thread === "object") {
    const t = thread as Record<string, unknown>;
    const mp = t.memory_packet;
    if (mp != null && typeof mp === "object") {
      const packet = mp as Record<string, unknown>;
      const full = packet.last_outbound_full_body;
      if (typeof full === "string" && full.trim()) return full.trim();
    }
    const latestOutbound = t.latest_outbound_sms;
    if (typeof latestOutbound === "string" && latestOutbound.trim()) return latestOutbound.trim();
  }
  return null;
}

function buildForbiddenCoachingFrames(args: {
  repeatedQuestion: string | null;
  repeatedPhrases: string[];
  blockedCandidateBody: string;
}): string[] {
  const frames = new Set<string>();
  for (const source of [
    args.repeatedQuestion,
    ...args.repeatedPhrases,
    args.blockedCandidateBody,
  ]) {
    const text = source?.trim();
    if (!text) continue;
    for (const clause of extractQuestionClausesFromBody(text)) {
      if (clause.length >= MIN_PHRASE_CHARS) frames.add(clause.slice(0, 200));
    }
  }
  return [...frames].slice(0, 6);
}

function looksLikePlanningOrReflectionCoachText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    hasFuturePlanIntentLanguage(text) ||
    /\b(what will you|what would you|consider|reflect|nurturing action|share your plan|what specific)\b/i.test(t)
  );
}

export function inferRecommendedRepeatRepairStrategy(args: {
  blockedCandidateBody: string;
  violationReason: SmsMemoryRepeatViolationReason;
  latestAnswerText?: string | null;
  pendingPlanProofActive?: boolean;
  suggestedCoachingMove?: string | null;
  repeatedQuestion?: string | null;
  repeatedPhrases?: string[];
}): SmsMemoryRepeatRepairStrategy {
  const closeLoopContext =
    args.pendingPlanProofActive === true || args.suggestedCoachingMove === "close_prior_plan_loop";
  if (closeLoopContext) return "outcome_check";

  if (
    args.violationReason === "repeated_answered_open_question" &&
    latestAnswerIsPlanNotProof(args.latestAnswerText)
  ) {
    return "outcome_check";
  }

  if (isClosePriorPlanLoopOutcomeQuestion(args.blockedCandidateBody)) {
    return "binary_truth_check";
  }

  const repeatedText = [args.repeatedQuestion, ...(args.repeatedPhrases ?? [])]
    .filter((s): s is string => Boolean(s?.trim()))
    .join(" ");
  if (looksLikePlanningOrReflectionCoachText(repeatedText)) {
    return "binary_truth_check";
  }

  if (args.suggestedCoachingMove === "ask_blocker") {
    return "barrier_check";
  }

  return "outcome_check";
}

export function pickAlternateRepeatRepairStrategy(
  primary: SmsMemoryRepeatRepairStrategy
): SmsMemoryRepeatRepairStrategy {
  const idx = REPAIR_STRATEGY_ALTERNATE_CHAIN.indexOf(primary);
  if (idx >= 0 && idx < REPAIR_STRATEGY_ALTERNATE_CHAIN.length - 1) {
    return REPAIR_STRATEGY_ALTERNATE_CHAIN[idx + 1]!;
  }
  return primary === "binary_truth_check" ? "outcome_check" : "binary_truth_check";
}

export function buildMemoryRepeatRepairContext(args: {
  routeKind: "daily" | "inbound" | "weekly";
  blockedCandidateBody: string;
  violation: SmsMemoryRepeatViolation;
  detectInput: Parameters<typeof detectSmsMemoryRepeatViolation>[0];
  factsJson: unknown;
}): MemoryRepeatRepairContext {
  void args.routeKind;
  const recommended = inferRecommendedRepeatRepairStrategy({
    blockedCandidateBody: args.blockedCandidateBody,
    violationReason: args.violation.reason,
    latestAnswerText: args.detectInput.latestAnswerText,
    pendingPlanProofActive: args.detectInput.pendingPlanProofActive,
    suggestedCoachingMove: args.detectInput.suggestedCoachingMove,
    repeatedQuestion: args.violation.repeatedQuestion,
    repeatedPhrases: args.violation.repeatedPhrases,
  });
  const examples = STRATEGY_EXAMPLE_SMS[recommended];
  return {
    prior_outbound_full_body: extractPriorOutboundFullBodyFromFactsJson(args.factsJson, args.detectInput),
    blocked_candidate_body: args.blockedCandidateBody,
    repeated_question: args.violation.repeatedQuestion,
    repeated_phrases: args.violation.repeatedPhrases,
    latest_user_answer: args.detectInput.latestAnswerText?.trim() ?? null,
    accountability_purpose: extractAccountabilityPurposeFromFactsJson(args.factsJson),
    suggested_coaching_move: args.detectInput.suggestedCoachingMove ?? null,
    repeat_violation_reason: args.violation.reason,
    recommended_repair_strategy: recommended,
    forbidden_coaching_frames: buildForbiddenCoachingFrames({
      repeatedQuestion: args.violation.repeatedQuestion,
      repeatedPhrases: args.violation.repeatedPhrases,
      blockedCandidateBody: args.blockedCandidateBody,
    }),
    strategy_examples: [examples[0], examples[1]],
  };
}

export function buildMemoryAntiRepeatRepairInstruction(args: {
  repeatedQuestion?: string | null;
  repeatedPhrases: string[];
  latestAnswerText?: string | null;
  reason: SmsMemoryRepeatViolationReason;
  pendingPlanProofActive?: boolean;
  suggestedCoachingMove?: string | null;
  repairContext?: MemoryRepeatRepairContext | null;
  forcedRepairStrategy?: SmsMemoryRepeatRepairStrategy | null;
}): string {
  const closeLoopContext =
    args.pendingPlanProofActive === true || args.suggestedCoachingMove === "close_prior_plan_loop";

  const parts = closeLoopContext
    ? [
        "The prior user reply was a plan or intention, not proof of completion.",
        "Rewrite to close that loop: ask whether the planned block or action happened (done, partial, or missed) in natural language.",
        "Do NOT merely repeat the prior coach question verbatim or paraphrase it.",
        "Do NOT tell the model to build on the plan answer as if it were proof.",
        "Keep one short SMS, human and direct.",
        "Do not mention memory, projection, databases, or internal systems.",
        "Return strict JSON with keys: body, used_strategy, safety_notes.",
      ]
    : [
        "The user already answered or was already asked this coach question recently.",
        "Do NOT paraphrase the repeated question. Do NOT ask the same thing in different words.",
        "Change the coaching move while preserving the same user facts, current goal, and accountability purpose.",
        "Write one natural, concise SMS that moves the relationship forward.",
        "Keep natural memory callbacks when they advance the thread (e.g. referencing when something tends to slip, or what they said last time) — but do not re-ask the same question frame.",
        "Do not mention memory, projection, databases, or internal systems.",
        "If a prior user answer is available, build on it — do not re-ask for the same information.",
        "Frame-shift guidance (change the move, not the wording): planning/reflection question → proof or completion check; \"what will you do?\" → honest follow-through such as whether one small thing happened; abstract self-care/reflection → concrete accountability tied to the current goal; answered open question → build on the answer instead of re-asking; repeated open question → shorter honesty check (yes/no/partial) when appropriate; silence/reentry → ask for truth, not another plan.",
        "Return strict JSON with keys: body, used_strategy, safety_notes.",
      ];
  if (args.reason === "repeated_answered_open_question" && args.latestAnswerText?.trim()) {
    parts.push(`Use this prior user answer as ground truth: "${args.latestAnswerText.trim().slice(0, 220)}".`);
  }
  if (args.repeatedQuestion?.trim()) {
    parts.push(`Do not repeat this coach question: "${args.repeatedQuestion.trim().slice(0, 200)}".`);
  }
  if (args.repeatedPhrases.length) {
    parts.push(
      `Avoid these repeated phrases: ${args.repeatedPhrases
        .slice(0, 4)
        .map((p) => `"${p.slice(0, 80)}"`)
        .join("; ")}.`
    );
  }

  if (args.repairContext) {
    const ctx = args.repairContext;
    const targetStrategy = args.forcedRepairStrategy ?? ctx.recommended_repair_strategy;
    parts.push(
      "This draft is too similar to prior coach messages. Rewrite with a FRESH coaching angle — not synonyms.",
      "Preserve the same accountability purpose; change the coaching move.",
      "Sound like the next natural SMS in a months-long text relationship.",
      "Do NOT reuse the forbidden question frames listed below.",
      `You MUST use coaching move strategy: ${targetStrategy}.`,
      `used_strategy in JSON MUST be exactly: ${targetStrategy}.`,
      `Allowed used_strategy values: ${SMS_MEMORY_REPEAT_REPAIR_STRATEGIES.join(", ")}.`,
      `Accountability purpose to preserve: ${ctx.accountability_purpose?.slice(0, 220) ?? "(same active commitment)"}.`
    );
    if (ctx.prior_outbound_full_body?.trim()) {
      parts.push(
        `Prior coach outbound (context only — do not paraphrase): "${ctx.prior_outbound_full_body.trim().slice(0, 220)}".`
      );
    }
    if (ctx.forbidden_coaching_frames.length) {
      parts.push(
        `Forbidden question frames (do not reuse): ${ctx.forbidden_coaching_frames
          .slice(0, 4)
          .map((f) => `"${f.slice(0, 100)}"`)
          .join("; ")}.`
      );
    }
    if (ctx.strategy_examples.length) {
      parts.push(`Examples of ${targetStrategy} tone: ${ctx.strategy_examples.map((e) => `"${e}"`).join("; ")}.`);
    }
    if (args.forcedRepairStrategy) {
      parts.push(
        "Your first rewrite was still too similar. You MUST switch to the forced strategy now — different question frame entirely."
      );
    }
  }

  return parts.join(" ");
}

const INBOUND_MEMORY_REPEAT_GUARD_ROUTES = new Set<string>([
  "normal_inbound_reply",
  "open_question_answer",
  "commitment_change_context",
  "conversation_brain_unavailable",
]);

const DAILY_MEMORY_REPEAT_GUARD_ROUTE_KINDS = new Set<string>([
  "main_active_accountability",
  "low_pressure_reactivation",
]);

const WEEKLY_MEMORY_REPEAT_GUARD_ROUTE_PURPOSES = new Set<string>(["weekly_proof_v2"]);

export function shouldRunInboundMemoryRepeatGuard(facts: InboundV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (facts.route_purpose === "adaptive_proposal_consent_accept") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_decline") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_noop_ack") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_clarification") return false;
  if (facts.contract_consent_facts != null) return false;
  return INBOUND_MEMORY_REPEAT_GUARD_ROUTES.has(facts.route_purpose);
}

export function shouldRunDailyMemoryRepeatGuard(facts: DailyV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (facts.route_kind === "contract_prompt") return false;
  if (facts.route_kind === "pending_resolution") return false;
  if (facts.route_kind === "refresh_identity") return false;
  if (facts.route_kind === "refresh_commitment") return false;
  return DAILY_MEMORY_REPEAT_GUARD_ROUTE_KINDS.has(facts.route_kind);
}

export function shouldRunWeeklyMemoryRepeatGuard(facts: WeeklyV3OutboundFacts): boolean {
  if (facts.constraints?.required_verbatim_substrings?.length) return false;
  if (facts.route.legacy_weekly_branch) return false;
  return WEEKLY_MEMORY_REPEAT_GUARD_ROUTE_PURPOSES.has(facts.route.route_purpose);
}

export function buildAntiRepeatDetectArgsFromWeeklyFacts(
  facts: WeeklyV3OutboundFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const coachQuestions: string[] = [
    ...facts.thread.last_5_coach_questions,
    facts.thread.latest_open_question,
  ].filter((t): t is string => Boolean(t?.trim()));

  for (const line of facts.thread.recent_transcript_lines ?? []) {
    const m = /^\s*Coach:\s*(.+)$/i.exec(line);
    if (m?.[1]?.trim()) coachQuestions.push(m[1].trim());
  }

  return {
    candidateBody,
    lastCoachQuestions: coachQuestions,
    doNotRepeatPhrases: facts.thread.do_not_repeat_hints,
    answeredOpenQuestion: facts.thread.latest_open_question,
    latestAnswerText: facts.thread.latest_answer_after_open_question,
    requiredVerbatimSubstrings: facts.constraints?.required_verbatim_substrings,
    routePurpose: facts.route.route_purpose,
  };
}

export function buildAntiRepeatDetectArgsFromInboundFacts(
  facts: InboundV3RelationshipFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const mp = facts.thread.memory_packet;
  const coachQuestions: string[] = [
    ...(mp?.last_5_coach_questions ?? []),
    facts.thread.latest_open_question,
    mp?.latest_open_question_guess,
    facts.thread.most_recent_coach_question,
  ].filter((t): t is string => Boolean(t?.trim()));

  for (const line of facts.thread.recent_transcript_lines ?? []) {
    const m = /^\s*Coach:\s*(.+)$/i.exec(line);
    if (m?.[1]?.trim()) coachQuestions.push(m[1].trim());
  }

  const dnr = [
    ...(mp?.do_not_repeat_phrases ?? []),
    ...facts.thread.do_not_repeat_hints.map((h) => h.replace(/^[^:]+:\s*/i, "").trim()).filter(Boolean),
  ];

  return {
    candidateBody,
    lastCoachQuestions: coachQuestions,
    doNotRepeatPhrases: dnr,
    answeredOpenQuestion:
      facts.thread.latest_open_question ?? mp?.latest_open_question ?? mp?.latest_open_question_guess ?? null,
    latestAnswerText:
      facts.thread.latest_answer_after_open_question ??
      mp?.latest_answer_after_open_question ??
      mp?.latest_answer_after_open_question_guess ??
      facts.thread.most_recent_substantive_prior_user_message ??
      null,
    requiredVerbatimSubstrings: facts.constraints.required_verbatim_substrings,
    routePurpose: facts.route_purpose,
  };
}

export function buildAntiRepeatDetectArgsFromDailyFacts(
  facts: DailyV3RelationshipFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const tm = facts.thread_memory;
  return {
    candidateBody,
    lastCoachQuestions: tm.last_5_coach_questions ?? [],
    doNotRepeatPhrases: tm.do_not_repeat_hints ?? [],
    answeredOpenQuestion: tm.latest_open_question ?? null,
    latestAnswerText: tm.latest_answer_after_open_question ?? null,
    requiredVerbatimSubstrings: facts.constraints.required_verbatim_substrings,
    routePurpose: facts.route_kind,
    pendingPlanProofActive: facts.accountability.pending_plan_proof?.active === true,
    suggestedCoachingMove: facts.suggested_coaching_move,
    lastOutboundFullBody: tm.last_outbound_full_body ?? tm.latest_outbound_sms ?? null,
  };
}

export type MemoryRepeatGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

export async function applySmsMemoryAntiRepeatGuard(args: {
  routeKind: "inbound" | "daily" | "weekly";
  routePurpose: string;
  body: string;
  factsJson: unknown;
  detectInput: Parameters<typeof detectSmsMemoryRepeatViolation>[0];
  enabled: boolean;
  validateAfterRepair: (body: string) => Promise<{ ok: true } | { ok: false; noSendReason: string; extraMeta?: Record<string, unknown> }>;
  additionalRepairInstruction?: string | null;
  noSendReason?: string;
}): Promise<MemoryRepeatGuardResult> {
  const blockedNoSendReason = args.noSendReason ?? "thread_memory_repeat_blocked";

  const buildRepeatMeta = (
    original: string,
    violation: SmsMemoryRepeatViolation,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    memory_repeat_guard_attempted: true,
    memory_repeat_guard_succeeded: false,
    memory_repeat_guard_reason: violation.reason,
    repeated_phrases: violation.repeatedPhrases,
    repeated_question: violation.repeatedQuestion,
    memory_repeat_original_body_preview: original.length > 220 ? `${original.slice(0, 219)}…` : original,
    memory_repeat_repaired_body_preview: null,
    memory_repeat_no_send_reason: null,
    repeat_detected: true,
    repeat_repair_attempted: true,
    repeat_repair_strategy: null,
    repeat_repair_succeeded: false,
    repeat_repair_failed_reason: null,
    repeat_repair_system: SMS_MEMORY_REPEAT_REPAIR_SYSTEM,
    forced_second_repair_attempted: false,
    ...extra,
  });

  if (!args.enabled) {
    return { outcome: "ok", body: args.body, metadata: {} };
  }

  const original = args.body.trim();
  const firstViolation = detectSmsMemoryRepeatViolation({ ...args.detectInput, candidateBody: original });

  if (!firstViolation.hasViolation) {
    return {
      outcome: "ok",
      body: original,
      metadata: {
        memory_repeat_guard_attempted: false,
        ...(firstViolation.closeLoopExemptionApplied
          ? {
              anti_repeat_close_loop_exemption_applied: true,
              anti_repeat_exemption_reason: "close_prior_plan_loop_outcome_question",
            }
          : {}),
      },
    };
  }

  const repairContext = buildMemoryRepeatRepairContext({
    routeKind: args.routeKind,
    blockedCandidateBody: original,
    violation: firstViolation,
    detectInput: args.detectInput,
    factsJson: args.factsJson,
  });

  const extraRepair = args.additionalRepairInstruction?.trim();
  let forcedSecondRepairAttempted = false;
  let lastRepairedPreview: string | null = null;
  let lastRepairMetadata: Record<string, unknown> = {};
  let lastFailedReason: string = "repair_failed";
  let lastPostValidateNoSendReason: string | null = null;
  let lastPostValidateExtraMeta: Record<string, unknown> = {};
  let winningStrategy: string | null = null;

  const strategiesToTry: SmsMemoryRepeatRepairStrategy[] = [
    repairContext.recommended_repair_strategy,
    pickAlternateRepeatRepairStrategy(repairContext.recommended_repair_strategy),
  ];

  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
    if (attemptIndex === 1) {
      forcedSecondRepairAttempted = true;
    }

    const forcedStrategy = strategiesToTry[attemptIndex]!;

    const repairInstruction = buildMemoryAntiRepeatRepairInstruction({
      repeatedQuestion: firstViolation.repeatedQuestion,
      repeatedPhrases: firstViolation.repeatedPhrases,
      latestAnswerText: args.detectInput.latestAnswerText ?? null,
      reason: firstViolation.reason,
      pendingPlanProofActive: args.detectInput.pendingPlanProofActive,
      suggestedCoachingMove: args.detectInput.suggestedCoachingMove,
      repairContext,
      forcedRepairStrategy: attemptIndex === 1 ? forcedStrategy : null,
    });

    const repairOut = await repairV3RelationshipLaneBodyWithOpenAI({
      routeKind: args.routeKind === "weekly" ? "weekly" : args.routeKind,
      routePurpose: args.routePurpose,
      originalBody: original,
      blockedReasons: ["memory_repeat_question"],
      factsJson: args.factsJson,
      systemInstruction: extraRepair ? `${repairInstruction}\n${extraRepair}` : repairInstruction,
      memoryRepeatRepairContext: repairContext,
      forcedRepairStrategy: forcedStrategy,
    });

    if (!repairOut?.body?.trim()) {
      lastFailedReason = "repair_failed";
      break;
    }

    const repaired = repairOut.body.replace(/^["']|["']$/g, "").trim();
    lastRepairedPreview = repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired;
    lastRepairMetadata = repairOut.metadata;
    winningStrategy =
      typeof repairOut.metadata.lane_repair_used_strategy === "string"
        ? repairOut.metadata.lane_repair_used_strategy
        : typeof repairOut.metadata.repeat_repair_strategy === "string"
          ? repairOut.metadata.repeat_repair_strategy
          : forcedStrategy ?? null;

    const afterRepairViolation = detectSmsMemoryRepeatViolation({
      ...args.detectInput,
      candidateBody: repaired,
    });

    if (afterRepairViolation.hasViolation) {
      lastFailedReason = "still_repeated_after_repair";
      if (attemptIndex === 0) {
        continue;
      }
      break;
    }

    const postValidate = await args.validateAfterRepair(repaired);
    if (!postValidate.ok) {
      lastFailedReason = "post_repair_validation_failed";
      lastPostValidateNoSendReason = postValidate.noSendReason;
      lastPostValidateExtraMeta = postValidate.extraMeta ?? {};
      break;
    }

    return {
      outcome: "ok",
      body: repaired,
      metadata: {
        memory_repeat_guard_attempted: true,
        memory_repeat_guard_succeeded: true,
        memory_repeat_guard_reason: firstViolation.reason,
        repeated_phrases: [],
        repeated_question: firstViolation.repeatedQuestion,
        memory_repeat_original_body_preview: original.length > 220 ? `${original.slice(0, 219)}…` : original,
        memory_repeat_repaired_body_preview: lastRepairedPreview,
        memory_repeat_no_send_reason: null,
        repeat_detected: true,
        repeat_repair_attempted: true,
        repeat_repair_strategy: winningStrategy,
        repeat_repair_succeeded: true,
        repeat_repair_failed_reason: null,
        repeat_repair_system: SMS_MEMORY_REPEAT_REPAIR_SYSTEM,
        forced_second_repair_attempted: forcedSecondRepairAttempted,
        ...repairOut.metadata,
      },
    };
  }

  return {
    outcome: "no_send",
    noSendReason:
      lastFailedReason === "post_repair_validation_failed" && lastPostValidateNoSendReason
        ? lastPostValidateNoSendReason
        : blockedNoSendReason,
    metadata: {
      ...buildRepeatMeta(original, firstViolation, {
        memory_repeat_no_send_reason: lastFailedReason,
        repeat_repair_failed_reason: lastFailedReason,
        repeat_repair_strategy: winningStrategy,
        memory_repeat_repaired_body_preview: lastRepairedPreview,
        forced_second_repair_attempted: forcedSecondRepairAttempted,
        memory_repeat_guard_reason: firstViolation.reason,
        ...lastPostValidateExtraMeta,
        ...lastRepairMetadata,
      }),
    },
  };
}

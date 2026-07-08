/**
 * Inbound Turn Understanding — single orchestration contract (meaning advisory; server owns truth).
 */

import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import { inboundExplicitOutcomeDetected } from "@/lib/inbound-short-answer-clauses";
import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import {
  buildInboundMeaningFacts,
  type InboundMeaningRoutePriority,
} from "@/lib/inbound-relationship-meaning";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import {
  buildInterpreterFailedSafeReconciled,
  enrichReconciledWithInboundRouteContract,
  isTurnUnderstandingAuthoritative,
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  type OpenAIRelationshipTurnUnderstandingV1,
  type ReconciledTurnUnderstanding,
  type TurnUnderstandingResponseIntent,
  resolveInboundTurnUnderstandingSkipReason,
  runInboundRelationshipTurnUnderstanding,
  slimTurnUnderstandingMetadata,
  type RunInboundTurnUnderstandingArgs,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk,
  normalizeTextForStaleAskOverlap,
  STALE_ASK_OVERLAP_STOP_WORDS,
} from "@/lib/stale-ask-safe-follow-up";

export {
  isTurnUnderstandingAuthoritative,
  reconciledTurnUnderstandingOverridesOpenQuestionFacts,
} from "@/lib/openai-relationship-turn-understanding-v1";

export type InboundTurnUnderstandingContext = {
  proposal?: OpenAIRelationshipTurnUnderstandingV1 | null;
  reconciled?: ReconciledTurnUnderstanding | null;
  inboundMeaningForPersist?: InboundMeaningFacts | null;
  didRun: boolean;
  skippedReason?: string | null;
  failedReason?: string | null;
};

export const TURN_UNDERSTANDING_FINAL_BODY_NO_SEND = "turn_understanding_stale_ask_blocked" as const;

const STALE_ASK_STOP_WORDS = STALE_ASK_OVERLAP_STOP_WORDS;

const SCHEDULING_ASK_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcalendar\b/i,
  /\bschedul(e|ing|uled)\b/i,
  /\bput\b.+\bon\b/i,
  /\bready to\b/i,
  /\blet me know\b/i,
  /\bwhen will you\b/i,
  /\bwhen can you\b/i,
  /\bare you ready\b/i,
  /\bstill want\b/i,
  /\bwhat time will you\b/i,
  /\bshould we get\b.+\bschedul/i,
  /\bwant to put\b.+\b(now|calendar)\b/i,
];

const REFLECTION_FOLLOW_UP_HINTS = [
  "enjoy",
  "present for",
  "intentional",
  "show up",
  "what do you want",
  "how do you want",
  "what would make",
  "what felt",
  "noticed",
];

const SAFE_NON_STALE_FOLLOW_UP_RES: ReadonlyArray<RegExp> = [
  /\bwhat helped you\b/i,
  /\bwhat made\b.+\bwork for you\b/i,
  /\bwhat do you want to carry\b/i,
  /\bwhat will help you protect\b/i,
  /\bwhat did you notice\b/i,
  /\bwhat felt best\b/i,
  /\bwhat helped\b.+\b(steps|workout|call)\b/i,
];

const PLAN_CONTINUATION_STALE_RES: ReadonlyArray<RegExp> = [
  /\bhow do you feel about\b.+\b(plan|continuing|rest of the week)\b/i,
  /\bhow does staying committed\b/i,
  /\bdoes this plan feel\b/i,
  /\bready to continue\b.+\bplan\b/i,
  /\bfeel about your plan for the rest of the week\b/i,
];

const SCHEDULING_NOUN_HINTS = [
  "calendar",
  "schedul",
  "family",
  "connection",
  "tomorrow",
  "tonight",
];

export function emptyInboundTurnUnderstandingContext(): InboundTurnUnderstandingContext {
  return { didRun: false, skippedReason: null, failedReason: null, reconciled: null };
}

export { normalizeTextForStaleAskOverlap } from "@/lib/stale-ask-safe-follow-up";

/** Shared overlap check — exact prefix + word overlap with question mark. */
export function substantiallyRepeatsCoachQuestion(proposedBody: string, coachLine: string): boolean {
  const p = normalizeTextForStaleAskOverlap(proposedBody);
  const c = normalizeTextForStaleAskOverlap(coachLine);
  if (c.length < 18 || p.length < 12) return false;
  const cWords = c.split(" ").filter((w) => w.length > 3 && !STALE_ASK_OVERLAP_STOP_WORDS.has(w));
  const pWords = new Set(
    p.split(" ").filter((w) => w.length > 3 && !STALE_ASK_OVERLAP_STOP_WORDS.has(w))
  );
  let overlap = 0;
  for (const w of cWords) if (pWords.has(w)) overlap++;
  const ratio = cWords.length ? overlap / cWords.length : 0;
  if (overlap >= 3 && ratio >= 0.45 && /\?/.test(proposedBody)) return true;
  if (p.includes(c.slice(0, Math.min(72, c.length)))) return true;
  return false;
}

function extractStaleAskKeyTokens(phraseNorm: string): string[] {
  return phraseNorm
    .split(" ")
    .filter((w) => w.length > 3 && !STALE_ASK_STOP_WORDS.has(w));
}

function looksLikeReflectionFollowUp(proposedBody: string, bodyNorm: string): boolean {
  const hasSchedulingAsk = SCHEDULING_ASK_PATTERNS.some((rx) => rx.test(proposedBody));
  if (hasSchedulingAsk) return false;
  return REFLECTION_FOLLOW_UP_HINTS.some((h) => bodyNorm.includes(h));
}

function looksLikeSafeNonStaleFollowUp(proposedBody: string): boolean {
  return SAFE_NON_STALE_FOLLOW_UP_RES.some((rx) => rx.test(proposedBody));
}

function looksLikePlanContinuationStaleAsk(proposedBody: string): boolean {
  return PLAN_CONTINUATION_STALE_RES.some((rx) => rx.test(proposedBody));
}

/** Conservative paraphrase detection for satisfied-ask do_not_repeat phrases. */
export function paraphraseRepeatsStaleCoachAsk(proposedBody: string, coachLine: string): boolean {
  if (isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk(proposedBody, coachLine)) {
    return false;
  }

  if (substantiallyRepeatsCoachQuestion(proposedBody, coachLine)) return true;

  const phraseNorm = normalizeTextForStaleAskOverlap(coachLine);
  const bodyNorm = normalizeTextForStaleAskOverlap(proposedBody);
  if (phraseNorm.length < 12 || bodyNorm.length < 12) return false;

  if (looksLikeReflectionFollowUp(proposedBody, bodyNorm)) return false;
  if (looksLikeSafeNonStaleFollowUp(proposedBody)) return false;

  if (looksLikePlanContinuationStaleAsk(proposedBody) && /\?/.test(proposedBody)) {
    return true;
  }

  const keyTokens = extractStaleAskKeyTokens(phraseNorm);
  if (keyTokens.length < 2) return false;

  let hits = 0;
  for (const t of keyTokens) {
    if (bodyNorm.includes(t)) hits++;
  }
  const tokenRatio = hits / keyTokens.length;

  const hasAskShape =
    /\?/.test(proposedBody) || SCHEDULING_ASK_PATTERNS.some((rx) => rx.test(proposedBody));
  const phraseImpliesAsk =
    /\?/.test(coachLine) || SCHEDULING_ASK_PATTERNS.some((rx) => rx.test(coachLine));

  if (!phraseImpliesAsk || !hasAskShape) return false;
  if (tokenRatio >= 0.38) return true;

  const schedulingNounHits = SCHEDULING_NOUN_HINTS.filter(
    (n) => phraseNorm.includes(n) && bodyNorm.includes(n)
  );
  if (schedulingNounHits.length >= 2 && tokenRatio >= 0.28) return true;

  if (
    schedulingNounHits.includes("calendar") &&
    (bodyNorm.includes("put") || bodyNorm.includes("ready")) &&
    hasAskShape
  ) {
    return true;
  }

  if (
    /\bshould we get\b/i.test(proposedBody) &&
    schedulingNounHits.length >= 1 &&
    (bodyNorm.includes("schedul") || bodyNorm.includes("family")) &&
    hasAskShape
  ) {
    return true;
  }

  return false;
}

export type StaleAskViolationInput = {
  reconciled: ReconciledTurnUnderstanding | null | undefined;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
};

export function detectReconciledTurnUnderstandingStaleAskViolation(
  body: string,
  input: StaleAskViolationInput
): { violation: boolean; repeatedPhrase: string | null } {
  const tu = input.reconciled;
  if (!tu || !isTurnUnderstandingAuthoritative(tu)) {
    return { violation: false, repeatedPhrase: null };
  }
  if (tu.last_ask_satisfied !== "yes" && !tu.stale_ask_risk) {
    return { violation: false, repeatedPhrase: null };
  }

  for (const phrase of tu.reconciled_do_not_repeat_asks) {
    const t = phrase.trim();
    if (t.length < 12) continue;
    if (paraphraseRepeatsStaleCoachAsk(body, t)) {
      return { violation: true, repeatedPhrase: t.slice(0, 120) };
    }
  }

  const coachQ =
    input.latestOpenQuestion?.trim() || input.lastCoachOutbound?.trim() || null;
  if (
    tu.last_ask_satisfied === "yes" &&
    coachQ &&
    coachQ.length >= 12 &&
    paraphraseRepeatsStaleCoachAsk(body, coachQ)
  ) {
    return { violation: true, repeatedPhrase: coachQ.slice(0, 120) };
  }

  return { violation: false, repeatedPhrase: null };
}

export function detectTurnUnderstandingStaleAskViolationFromFacts(
  body: string,
  facts: InboundV3RelationshipFacts
): { violation: boolean; repeatedPhrase: string | null } {
  return detectReconciledTurnUnderstandingStaleAskViolation(body, {
    reconciled: facts.turn_understanding,
    latestOpenQuestion:
      facts.thread.latest_open_question ?? facts.thread.memory_packet?.latest_open_question ?? null,
    lastCoachOutbound:
      facts.thread.memory_packet?.last_outbound_full_body ??
      facts.thread.latest_outbound_coach_sms ??
      null,
  });
}

export type InboundFinalBodyTurnUnderstandingGuardResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: typeof TURN_UNDERSTANDING_FINAL_BODY_NO_SEND | null;
  metadata: Record<string, unknown>;
};

export function applyInboundFinalBodyTurnUnderstandingGuard(args: {
  body: string;
  context: InboundTurnUnderstandingContext | null | undefined;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  stage?: string;
}): InboundFinalBodyTurnUnderstandingGuardResult {
  const stage = args.stage ?? "pre_send";
  const baseMeta: Record<string, unknown> = {
    turn_understanding_final_body_guard_ran: true,
    turn_understanding_final_body_guard_stage: stage,
    turn_understanding_applied: Boolean(args.context?.reconciled && !args.context.skippedReason),
    turn_understanding_skip_reason: args.context?.skippedReason ?? null,
  };

  const reconciled = args.context?.reconciled;
  if (!reconciled || args.context?.skippedReason) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        turn_understanding_final_body_violation_detected: false,
        final_body_stale_ask_blocked: false,
      },
    };
  }

  if (!isTurnUnderstandingAuthoritative(reconciled)) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        turn_understanding_final_body_violation_detected: false,
        final_body_stale_ask_blocked: false,
        turn_understanding_final_body_guard_skipped: "interpreter_failed_no_safe_fallback",
      },
    };
  }

  const violation = detectReconciledTurnUnderstandingStaleAskViolation(args.body, {
    reconciled,
    latestOpenQuestion: args.latestOpenQuestion,
    lastCoachOutbound: args.lastCoachOutbound,
  });

  if (!violation.violation) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        turn_understanding_final_body_violation_detected: false,
        turn_understanding_stale_ask_violation_detected: false,
        final_body_stale_ask_blocked: false,
        stale_ask_avoided: reconciled.stale_ask_avoided,
        do_not_repeat_asks: reconciled.reconciled_do_not_repeat_asks,
      },
    };
  }

  return buildStaleAskBlockedGuardResult({
    baseMeta,
    reconciled,
    violation,
    stage,
  });
}

function buildStaleAskBlockedGuardResult(args: {
  baseMeta: Record<string, unknown>;
  reconciled: ReconciledTurnUnderstanding;
  violation: { violation: boolean; repeatedPhrase: string | null };
  stage: string;
  repairMetadata?: Record<string, unknown>;
}): InboundFinalBodyTurnUnderstandingGuardResult {
  const meta: Record<string, unknown> = {
    ...args.baseMeta,
    ...args.repairMetadata,
    turn_understanding_final_body_violation_detected: true,
    turn_understanding_stale_ask_violation_detected: true,
    turn_understanding_final_body_repair_attempted:
      args.repairMetadata?.turn_understanding_stale_ask_repair_attempted ?? false,
    turn_understanding_stale_ask_repair_attempted:
      args.repairMetadata?.turn_understanding_stale_ask_repair_attempted ?? false,
    turn_understanding_final_body_repair_succeeded:
      args.repairMetadata?.turn_understanding_stale_ask_repair_succeeded ?? false,
    turn_understanding_stale_ask_repair_succeeded:
      args.repairMetadata?.turn_understanding_stale_ask_repair_succeeded ?? false,
    turn_understanding_final_body_no_send_reason: TURN_UNDERSTANDING_FINAL_BODY_NO_SEND,
    turn_understanding_stale_ask_no_send_reason: TURN_UNDERSTANDING_FINAL_BODY_NO_SEND,
    final_body_stale_ask_blocked: true,
    turn_understanding_stale_ask_phrase: args.violation.repeatedPhrase,
    stale_ask_phrase: args.violation.repeatedPhrase,
    do_not_repeat_asks: args.reconciled.reconciled_do_not_repeat_asks,
    final_body_guard_stage: args.stage,
  };
  return {
    body: "",
    shouldSend: false,
    noSendReason: TURN_UNDERSTANDING_FINAL_BODY_NO_SEND,
    metadata: meta,
  };
}

const ANSWERED_PRIOR_ASK_CLOSE_LOOP_INBOUND_MEANINGS = new Set<InboundMeaningFacts["relationship_meaning"]>([
  "answer_to_prior_question",
  "plan_made",
]);

const ANSWERED_PRIOR_ASK_CLOSE_LOOP_RESPONSE_INTENTS = new Set<TurnUnderstandingResponseIntent>([
  "close_loop_no_new_action",
  "acknowledge_prior_ask_satisfied",
  "answer_user_question",
  "reinforce_plan_without_proof",
]);

const ANSWERED_PRIOR_ASK_CLOSE_LOOP_MOVES = new Set([
  "close_loop_no_new_action",
  "acknowledge_prior_ask_satisfied",
  "protect_existing_plan",
  "respond_to_open_question_answer_natural",
  "acknowledge_prior_answer_without_reasking",
]);

/** User answered/satisfied the prior coach ask — stale re-ask repair may close the loop instead of ghosting. */
export function isAnsweredPriorAskCloseLoopEligible(args: {
  reconciled: ReconciledTurnUnderstanding | null | undefined;
  inboundMeaning?: InboundMeaningFacts | null;
  rawInbound?: string | null;
  currentInboundIsShortAcknowledgement?: boolean;
  suggestedCoachingMove?: string | null;
  latestAnswerAfterOpenQuestion?: string | null;
}): boolean {
  if (args.currentInboundIsShortAcknowledgement) return false;
  if (inboundExplicitOutcomeDetected(args.rawInbound ?? "")) return false;

  const tu = args.reconciled;
  if (!tu || !isTurnUnderstandingAuthoritative(tu)) return false;

  const meaning = args.inboundMeaning?.relationship_meaning;
  const askExplicitlySatisfied =
    tu.last_ask_satisfied === "yes" || tu.proposal?.answered_last_coach_ask === "yes";
  const answeredViaOpenQuestion =
    Boolean(args.latestAnswerAfterOpenQuestion?.trim()) &&
    meaning != null &&
    ANSWERED_PRIOR_ASK_CLOSE_LOOP_INBOUND_MEANINGS.has(meaning);
  const answeredViaCloseLoopIntent =
    askExplicitlySatisfied &&
    (ANSWERED_PRIOR_ASK_CLOSE_LOOP_RESPONSE_INTENTS.has(tu.reconciled_response_intent) ||
      (args.suggestedCoachingMove != null &&
        ANSWERED_PRIOR_ASK_CLOSE_LOOP_MOVES.has(args.suggestedCoachingMove)));

  const answeredPriorAsk =
    askExplicitlySatisfied || answeredViaOpenQuestion || answeredViaCloseLoopIntent;

  if (!answeredPriorAsk) return false;

  return (
    tu.last_ask_satisfied === "yes" ||
    tu.stale_ask_risk ||
    tu.reconciled_do_not_repeat_asks.length > 0
  );
}

function buildStaleAskCloseLoopRepairSystemInstruction(args: {
  repeatedPhrase: string | null;
  doNotRepeatAsks: string[];
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  reconciled?: ReconciledTurnUnderstanding | null;
}): string {
  const dnr = args.doNotRepeatAsks.slice(0, 4).join(" | ");
  const inboundPreview = args.rawInbound?.trim().slice(0, 200) ?? "";
  const meaning = args.reconciled?.reconciled_relationship_meaning ?? args.inboundMeaning?.relationship_meaning;
  const goalChange = args.reconciled?.reconciled_goal_change_intent;
  const goalChangeBridge =
    goalChange?.authoritative && goalChange.detected
      ? " GOAL-CHANGE BRIDGE: acknowledge amend/restate/reset/adjust intent; statement-only close-loop; do NOT ask what specific changes again; do NOT claim goal mutated."
      : "";
  return `ANSWERED-PRIOR-ASK CLOSE-LOOP REPAIR: The draft repeats a coach question the user already answered.
Rewrite as a short human close-loop acknowledgement of the user's answer.
Do not re-ask the satisfied question or paraphrase it as a new ask.
Do not ask another scheduling, commitment, or accountability question.
Do not claim completion, proof saved, Victory, or any server state change.${goalChangeBridge}
Do NOT repeat or paraphrase these stale asks: ${dnr || args.repeatedPhrase || "prior satisfied ask"}.
Latest inbound preview: ${inboundPreview || "(none)"}.
Inbound meaning hint: ${meaning ?? "unclear"}.
No hard-coded templates. One short SMS.`;
}

function buildStaleAskRepairSystemInstruction(args: {
  repeatedPhrase: string | null;
  doNotRepeatAsks: string[];
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  reconciled?: ReconciledTurnUnderstanding | null;
}): string {
  const dnr = args.doNotRepeatAsks.slice(0, 4).join(" | ");
  const inboundPreview = args.rawInbound?.trim().slice(0, 200) ?? "";
  const meaning = args.reconciled?.reconciled_relationship_meaning ?? args.inboundMeaning?.relationship_meaning;
  return `STALE ASK REPAIR: The draft repeats a coach question the user already answered or satisfied.
Do NOT repeat or paraphrase these stale asks: ${dnr || args.repeatedPhrase || "prior satisfied ask"}.
The user already answered/satisfied the prior ask. Remove the stale question tail entirely.
Preserve any supported truth from the latest inbound only when evidence supports it.
Latest inbound preview: ${inboundPreview || "(none)"}.
Inbound meaning hint: ${meaning ?? "unclear"}.
If the user reported completion with evidence, you may acknowledge completion briefly — no fake proof or Victory language.
If the user gave a concrete plan detail, acknowledge that specific plan detail.
Ask at most one non-stale next question, or close the loop without re-asking the stale prompt.
No hard-coded templates. One short SMS.`;
}

export type TryRepairInboundStaleAskViolationArgs = {
  body: string;
  violation: { violation: boolean; repeatedPhrase: string | null };
  reconciled: ReconciledTurnUnderstanding;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  routePurpose?: string;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: import("@/lib/sms-relationship-repair-snapshot-v1").RepairRelationshipSnapshotV1 | null;
  closeLoopEligible?: boolean;
  repairPass?: 1 | 2;
};

export async function tryRepairInboundStaleAskViolation(
  args: TryRepairInboundStaleAskViolationArgs
): Promise<{ body: string; metadata: Record<string, unknown> } | null> {
  const instructionArgs = {
    repeatedPhrase: args.violation.repeatedPhrase,
    doNotRepeatAsks: args.reconciled.reconciled_do_not_repeat_asks,
    rawInbound: args.rawInbound,
    inboundMeaning: args.inboundMeaning,
    reconciled: args.reconciled,
  };
  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: args.routePurpose ?? "turn_understanding_stale_ask_guard",
    originalBody: args.body,
    blockedReasons: ["turn_understanding_stale_ask"],
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    repairPass: args.repairPass,
    systemInstruction: args.closeLoopEligible
      ? buildStaleAskCloseLoopRepairSystemInstruction(instructionArgs)
      : buildStaleAskRepairSystemInstruction(instructionArgs),
  });

  if (!repair?.body?.trim()) {
    return null;
  }

  return {
    body: repair.body.trim(),
    metadata: {
      turn_understanding_stale_ask_repair_attempted: true,
      turn_understanding_final_body_repair_attempted: true,
      turn_understanding_stale_ask_repair_openai_ok: repair.openAiOk,
      turn_understanding_stale_ask_repair_metadata: repair.metadata,
      stale_guard_repair_body_preview: repair.body.trim().slice(0, 220),
      answered_prior_ask_close_loop_repair: args.closeLoopEligible === true,
      ...(args.repairPass != null
        ? { answered_prior_ask_close_loop_repair_pass: args.repairPass }
        : {}),
    },
  };
}

export type ResolveStaleAskViolationWithRepairArgs = {
  body: string;
  violation: { violation: boolean; repeatedPhrase: string | null };
  reconciled: ReconciledTurnUnderstanding;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  routePurpose?: string;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: TryRepairInboundStaleAskViolationArgs["repairSnapshot"];
  currentInboundIsShortAcknowledgement?: boolean;
  suggestedCoachingMove?: string | null;
  latestAnswerAfterOpenQuestion?: string | null;
  closeLoopEligible?: boolean;
  recheckStaleAsk: (body: string) => { violation: boolean; repeatedPhrase: string | null };
};

export async function resolveStaleAskViolationWithRepair(
  args: ResolveStaleAskViolationWithRepairArgs
): Promise<
  | { ok: true; body: string; repairMeta: Record<string, unknown> }
  | { ok: false; repairMeta: Record<string, unknown> }
> {
  const closeLoopEligible =
    args.closeLoopEligible ??
    isAnsweredPriorAskCloseLoopEligible({
      reconciled: args.reconciled,
      inboundMeaning: args.inboundMeaning,
      rawInbound: args.rawInbound,
      currentInboundIsShortAcknowledgement: args.currentInboundIsShortAcknowledgement,
      suggestedCoachingMove: args.suggestedCoachingMove,
      latestAnswerAfterOpenQuestion: args.latestAnswerAfterOpenQuestion,
    });

  const baseRepairMeta: Record<string, unknown> = {
    answered_prior_ask_close_loop_repair_eligible: closeLoopEligible,
  };

  const attempt = async (candidateBody: string, pass?: 1 | 2) => {
    const repaired = await tryRepairInboundStaleAskViolation({
      body: candidateBody,
      violation: args.violation,
      reconciled: args.reconciled,
      latestOpenQuestion: args.latestOpenQuestion,
      lastCoachOutbound: args.lastCoachOutbound,
      rawInbound: args.rawInbound,
      inboundMeaning: args.inboundMeaning,
      routePurpose: args.routePurpose,
      factsJson: args.factsJson,
      repairSnapshot: args.repairSnapshot,
      closeLoopEligible,
      repairPass: pass,
    });
    if (!repaired?.body) return null;
    const recheck = args.recheckStaleAsk(repaired.body);
    return { repaired, stillStale: recheck.violation };
  };

  const first = await attempt(args.body, closeLoopEligible ? 1 : undefined);
  if (!first) {
    return {
      ok: false,
      repairMeta: {
        ...baseRepairMeta,
        turn_understanding_stale_ask_repair_attempted: true,
        turn_understanding_stale_ask_repair_succeeded: false,
      },
    };
  }

  if (!first.stillStale) {
    return {
      ok: true,
      body: first.repaired.body,
      repairMeta: {
        ...baseRepairMeta,
        ...first.repaired.metadata,
        turn_understanding_stale_ask_repair_succeeded: true,
        answered_prior_ask_close_loop_repair_succeeded: closeLoopEligible,
      },
    };
  }

  if (closeLoopEligible) {
    const second = await attempt(first.repaired.body, 2);
    if (second && !second.stillStale) {
      return {
        ok: true,
        body: second.repaired.body,
        repairMeta: {
          ...baseRepairMeta,
          ...second.repaired.metadata,
          turn_understanding_stale_ask_repair_succeeded: true,
          answered_prior_ask_close_loop_repair_succeeded: true,
          answered_prior_ask_close_loop_repair_second_pass: true,
        },
      };
    }
  }

  return {
    ok: false,
    repairMeta: {
      ...baseRepairMeta,
      ...first.repaired.metadata,
      turn_understanding_stale_ask_repair_succeeded: false,
      answered_prior_ask_close_loop_repair_succeeded: false,
    },
  };
}

const ANSWERED_PRIOR_ASK_POST_VALIDATE_PROTECT_MOVES = new Set([
  "close_loop_no_new_action",
  "acknowledge_prior_ask_satisfied",
  "respond_to_open_question_answer_natural",
  "acknowledge_prior_answer_without_reasking",
  "reinforce_plan_without_proof",
  "close_prior_plan_loop",
  "next_first_step",
]);

const POST_VALIDATE_CLOSE_LOOP_ROUTE_PURPOSES = new Set([
  "normal_inbound_reply",
  "open_question_answer",
]);

const TRIVIAL_INBOUND_ACK_ONLY_RE = /^(ok|okay|yes|yep|yup|sure|thanks|thx|got it)\.?$/i;

export function inboundHasConcretePlanOrAnswerDetail(rawInbound: string | null | undefined): boolean {
  const t = rawInbound?.trim() ?? "";
  if (t.length < 4) return false;
  if (TRIVIAL_INBOUND_ACK_ONLY_RE.test(t)) return false;
  return true;
}

export function isProtectOrCloseLoopCoachingMove(suggestedCoachingMove: string | null | undefined): boolean {
  const move = suggestedCoachingMove?.trim();
  if (!move) return false;
  return ANSWERED_PRIOR_ASK_POST_VALIDATE_PROTECT_MOVES.has(move);
}

/** Post-validate close-loop when user answered prior ask — uses inbound_meaning, not authoritative TU. */
export function isAnsweredPriorAskPostValidateCloseLoopEligible(args: {
  inboundMeaning?: InboundMeaningFacts | null;
  rawInbound?: string | null;
  currentInboundIsShortAcknowledgement?: boolean;
  suggestedCoachingMove?: string | null;
  routePurpose?: string | null;
}): boolean {
  if (args.currentInboundIsShortAcknowledgement) return false;
  if (inboundExplicitOutcomeDetected(args.rawInbound ?? "")) return false;
  if (!inboundHasConcretePlanOrAnswerDetail(args.rawInbound)) return false;

  const meaning = args.inboundMeaning?.relationship_meaning;
  if (!meaning || !ANSWERED_PRIOR_ASK_CLOSE_LOOP_INBOUND_MEANINGS.has(meaning)) {
    return false;
  }

  if (args.inboundMeaning?.persistence_decision !== "no_outcome_write") {
    return false;
  }

  if (!isProtectOrCloseLoopCoachingMove(args.suggestedCoachingMove)) {
    return false;
  }

  const route = args.routePurpose?.trim() ?? "normal_inbound_reply";
  return POST_VALIDATE_CLOSE_LOOP_ROUTE_PURPOSES.has(route);
}

export function postValidateCloseLoopBlockedReasonsEligible(
  initialBlocked: string[],
  repairedBlocked?: string[] | null
): boolean {
  const all = [...initialBlocked, ...(repairedBlocked ?? [])];
  return all.some(
    (r) =>
      r === "generic_momentum" ||
      r === "thread_freshness_validation_failed" ||
      r.startsWith("thread_freshness_")
  );
}

export function buildPostValidateCloseLoopProtectPlanRepairInstruction(args: {
  doNotRepeatAsks: string[];
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  blockedReasons: string[];
}): string {
  const dnr = args.doNotRepeatAsks.slice(0, 4).join(" | ");
  const inboundPreview = args.rawInbound?.trim().slice(0, 200) ?? "";
  const meaning = args.inboundMeaning?.relationship_meaning ?? "unclear";
  const blocked = args.blockedReasons.slice(0, 6).join(", ");
  return `ANSWERED-PRIOR-ASK POST-VALIDATE CLOSE-LOOP REPAIR: The user already answered the prior coach ask with a concrete plan or detail.
Rewrite as a short human acknowledgement that protects the specific plan they stated in their latest inbound.
Do not use generic momentum phrases (keep momentum, let's keep going, continuing momentum, etc.).
Do not suggest additional scheduling, extra calls, or new tasks beyond what the user already confirmed.
Do not ask another question — close the loop without a new ask.
Do not claim completion, proof saved, Victory, or any server state change.
Do NOT repeat or paraphrase these stale asks: ${dnr || "prior satisfied ask"}.
Latest inbound preview: ${inboundPreview || "(none)"}.
Inbound meaning hint: ${meaning}.
Blocked issues to fix: ${blocked || "generic_momentum"}.
No hard-coded templates. One short SMS.`;
}

export async function tryRepairInboundPostValidateCloseLoop(
  args: {
    body: string;
    blockedReasons: string[];
    doNotRepeatAsks: string[];
    rawInbound?: string | null;
    inboundMeaning?: InboundMeaningFacts | null;
    routePurpose?: string;
    factsJson?: Record<string, unknown> | null;
    repairSnapshot?: TryRepairInboundStaleAskViolationArgs["repairSnapshot"];
    repairPass?: 1 | 2;
  }
): Promise<{ body: string; metadata: Record<string, unknown> } | null> {
  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: args.routePurpose ?? "answered_prior_ask_post_validate_close_loop",
    originalBody: args.body,
    blockedReasons: args.blockedReasons,
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    repairPass: args.repairPass,
    systemInstruction: buildPostValidateCloseLoopProtectPlanRepairInstruction({
      doNotRepeatAsks: args.doNotRepeatAsks,
      rawInbound: args.rawInbound,
      inboundMeaning: args.inboundMeaning,
      blockedReasons: args.blockedReasons,
    }),
  });

  if (!repair?.body?.trim()) {
    return null;
  }

  return {
    body: repair.body.trim(),
    metadata: {
      answered_prior_ask_close_loop_post_validate_attempted: true,
      answered_prior_ask_close_loop_post_validate_repair_openai_ok: repair.openAiOk,
      answered_prior_ask_close_loop_post_validate_repair_metadata: repair.metadata,
      answered_prior_ask_close_loop_post_validate_repair_body_preview: repair.body.trim().slice(0, 220),
      ...(args.repairPass != null
        ? { answered_prior_ask_close_loop_post_validate_repair_pass: args.repairPass }
        : {}),
    },
  };
}

export async function resolvePostValidateCloseLoopRepair(args: {
  body: string;
  blockedReasons: string[];
  doNotRepeatAsks: string[];
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
  routePurpose?: string;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: TryRepairInboundStaleAskViolationArgs["repairSnapshot"];
  validateCandidate: (body: string) => boolean;
}): Promise<
  | { ok: true; body: string; repairMeta: Record<string, unknown> }
  | { ok: false; repairMeta: Record<string, unknown> }
> {
  const baseMeta: Record<string, unknown> = {
    answered_prior_ask_close_loop_post_validate_eligible: true,
    answered_prior_ask_close_loop_post_validate_attempted: true,
  };

  const attempt = async (candidateBody: string, pass?: 1 | 2) => {
    const repaired = await tryRepairInboundPostValidateCloseLoop({
      body: candidateBody,
      blockedReasons: args.blockedReasons,
      doNotRepeatAsks: args.doNotRepeatAsks,
      rawInbound: args.rawInbound,
      inboundMeaning: args.inboundMeaning,
      routePurpose: args.routePurpose,
      factsJson: args.factsJson,
      repairSnapshot: args.repairSnapshot,
      repairPass: pass,
    });
    if (!repaired?.body) return null;
    return { repaired, valid: args.validateCandidate(repaired.body) };
  };

  const first = await attempt(args.body, 1);
  if (!first) {
    return {
      ok: false,
      repairMeta: {
        ...baseMeta,
        answered_prior_ask_close_loop_post_validate_succeeded: false,
      },
    };
  }

  if (first.valid) {
    return {
      ok: true,
      body: first.repaired.body,
      repairMeta: {
        ...baseMeta,
        ...first.repaired.metadata,
        answered_prior_ask_close_loop_post_validate_succeeded: true,
      },
    };
  }

  const second = await attempt(first.repaired.body, 2);
  if (second?.valid) {
    return {
      ok: true,
      body: second.repaired.body,
      repairMeta: {
        ...baseMeta,
        ...second.repaired.metadata,
        answered_prior_ask_close_loop_post_validate_succeeded: true,
        answered_prior_ask_close_loop_post_validate_second_pass: true,
      },
    };
  }

  return {
    ok: false,
    repairMeta: {
      ...baseMeta,
      ...(first.repaired.metadata ?? {}),
      ...(second?.repaired.metadata ?? {}),
      answered_prior_ask_close_loop_post_validate_succeeded: false,
    },
  };
}

export async function applyInboundFinalBodyTurnUnderstandingGuardAsync(args: {
  body: string;
  context: InboundTurnUnderstandingContext | null | undefined;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  stage?: string;
  routePurpose?: string;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: TryRepairInboundStaleAskViolationArgs["repairSnapshot"];
  rawInbound?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
}): Promise<InboundFinalBodyTurnUnderstandingGuardResult> {
  const stage = args.stage ?? "pre_send";
  const initial = applyInboundFinalBodyTurnUnderstandingGuard({
    body: args.body,
    context: args.context,
    latestOpenQuestion: args.latestOpenQuestion,
    lastCoachOutbound: args.lastCoachOutbound,
    stage,
  });

  if (initial.shouldSend || !args.context?.reconciled) {
    return initial;
  }

  const reconciled = args.context.reconciled;
  const violation = detectReconciledTurnUnderstandingStaleAskViolation(args.body, {
    reconciled,
    latestOpenQuestion: args.latestOpenQuestion,
    lastCoachOutbound: args.lastCoachOutbound,
  });
  if (!violation.violation) {
    return initial;
  }

  const inboundMeaning = args.inboundMeaning ?? args.context.inboundMeaningForPersist ?? null;
  const resolved = await resolveStaleAskViolationWithRepair({
    body: args.body,
    violation,
    reconciled,
    latestOpenQuestion: args.latestOpenQuestion,
    lastCoachOutbound: args.lastCoachOutbound,
    rawInbound: args.rawInbound,
    inboundMeaning,
    routePurpose: args.routePurpose,
    factsJson: args.factsJson,
    repairSnapshot: args.repairSnapshot,
    recheckStaleAsk: (candidate) =>
      detectReconciledTurnUnderstandingStaleAskViolation(candidate, {
        reconciled,
        latestOpenQuestion: args.latestOpenQuestion,
        lastCoachOutbound: args.lastCoachOutbound,
      }),
  });

  if (!resolved.ok) {
    return buildStaleAskBlockedGuardResult({
      baseMeta: {
        ...initial.metadata,
        ...resolved.repairMeta,
        turn_understanding_final_body_repair_attempted: true,
        turn_understanding_final_body_repair_succeeded: false,
        explicit_outcome_detected: inboundExplicitOutcomeDetected(args.rawInbound ?? ""),
      },
      reconciled,
      violation,
      stage,
      repairMetadata: resolved.repairMeta,
    });
  }

  return {
    body: resolved.body,
    shouldSend: true,
    noSendReason: null,
    metadata: {
      ...initial.metadata,
      ...resolved.repairMeta,
      turn_understanding_final_body_violation_detected: true,
      turn_understanding_stale_ask_violation_detected: true,
      turn_understanding_final_body_repair_succeeded: true,
      final_body_stale_ask_blocked: false,
      turn_understanding_stale_ask_phrase: violation.repeatedPhrase,
      stale_ask_phrase: violation.repeatedPhrase,
      explicit_outcome_detected: inboundExplicitOutcomeDetected(args.rawInbound ?? ""),
      final_body_guard_stage: stage,
    },
  };
}

export type RunInboundTurnUnderstandingContextArgs = Omit<
  RunInboundTurnUnderstandingArgs,
  "routePurpose"
> & {
  /** Interpreter route purpose — use normal_inbound_reply for open-question coaching paths. */
  interpreterRoutePurpose?: string | null;
};

/** Run live TU once; returns unified context for facts, persist, and final guard. */
export async function runInboundTurnUnderstandingContext(
  args: RunInboundTurnUnderstandingContextArgs
): Promise<InboundTurnUnderstandingContext> {
  const interpreterRoutePurpose = args.interpreterRoutePurpose ?? "normal_inbound_reply";
  const routePriority = args.routePriority ?? {};
  const skipReason = resolveInboundTurnUnderstandingSkipReason({
    routePurpose: interpreterRoutePurpose,
    routePriority,
  });

  const inboundMeaningForPersist = buildInboundMeaningFacts({
    rawInbound: args.inboundBody,
    receivedAt: new Date(args.receivedAtIso),
    timezone: args.timezone,
    classifierEventType: args.classifierEventType,
    classifierNormalizedHint: args.classifierNormalizedHint,
    routePriority,
    openQuestionPending: args.openQuestionPending,
    latestOpenQuestion: args.latestOpenQuestion,
    latestOutboundBody: args.lastCoachOutbound,
    expectedAnswerType: args.expectedAnswerType,
    expectedReplySemantics: args.expectedReplySemantics,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
    commitmentTitle: args.commitmentTitle,
    recentEventsNewestFirst: args.recentEventsNewestFirst,
  });

  if (skipReason) {
    return {
      didRun: false,
      skippedReason: skipReason,
      failedReason: null,
      reconciled: null,
      proposal: null,
      inboundMeaningForPersist,
    };
  }

  let reconciled = await runInboundRelationshipTurnUnderstanding({
    ...args,
    routePurpose: interpreterRoutePurpose,
  });

  if (!reconciled) {
    return {
      didRun: false,
      skippedReason: "interpreter_skipped",
      failedReason: null,
      reconciled: null,
      proposal: null,
      inboundMeaningForPersist,
    };
  }

  if (reconciled.interpreter_failed_reason) {
    reconciled = enrichReconciledWithInboundRouteContract(
      buildInterpreterFailedSafeReconciled({
        interpreterFailedReason: reconciled.interpreter_failed_reason,
        proposal: reconciled.proposal,
        deterministicMeaning: inboundMeaningForPersist,
        latestCoachQuestion: args.latestOpenQuestion ?? args.lastCoachOutbound,
        openQuestionPending: args.openQuestionPending,
        rawInbound: args.inboundBody,
        classifierEventType: args.classifierEventType,
        failureDiagnostics: reconciled.turn_understanding_failure_diagnostics ?? null,
      }),
      {
        rawInbound: args.inboundBody,
        openQuestionPending: args.openQuestionPending,
        latestOpenQuestion: args.latestOpenQuestion,
        classifierEventType: args.classifierEventType,
      }
    );
  }

  return {
    didRun: true,
    skippedReason: null,
    failedReason: reconciled.interpreter_failed_reason,
    reconciled,
    proposal: reconciled.proposal,
    inboundMeaningForPersist,
  };
}

export function isInboundTurnUnderstandingContextAuthoritative(
  ctx: InboundTurnUnderstandingContext | null | undefined
): boolean {
  if (!ctx || ctx.skippedReason) return false;
  return isTurnUnderstandingAuthoritative(ctx.reconciled);
}

export function inboundTurnUnderstandingContextMetadata(
  ctx: InboundTurnUnderstandingContext | null | undefined
): Record<string, unknown> {
  if (!ctx) {
    return {
      openai_turn_understanding_version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
      turn_understanding_applied: false,
      turn_understanding_applied_to_persist: false,
    };
  }
  const applied = Boolean(
    ctx.reconciled && !ctx.skippedReason && isTurnUnderstandingAuthoritative(ctx.reconciled)
  );
  return {
    openai_turn_understanding_version: OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
    turn_understanding_applied: applied,
    turn_understanding_applied_to_persist: applied,
    turn_understanding_did_run: ctx.didRun,
    turn_understanding_skip_reason: ctx.skippedReason ?? null,
    turn_understanding_failed_reason: ctx.failedReason ?? null,
    ...(ctx.reconciled?.turn_understanding_failed_safe_fallback
      ? {
          turn_understanding_failed_safe_fallback: true,
          turn_understanding_failed_safe_reason:
            ctx.reconciled.turn_understanding_failed_safe_reason ?? ctx.failedReason,
          turn_understanding_failed_safe_do_not_repeat_asks:
            ctx.reconciled.turn_understanding_failed_safe_do_not_repeat_asks ??
            ctx.reconciled.reconciled_do_not_repeat_asks,
        }
      : {}),
    ...(ctx.reconciled
      ? slimTurnUnderstandingMetadata(ctx.reconciled)
      : {}),
  };
}

export function persistArgsFromTurnUnderstandingContext(
  ctx: InboundTurnUnderstandingContext | null | undefined
): {
  turnUnderstandingReconciled: ReconciledTurnUnderstanding | null;
  inboundMeaningForPersist: InboundMeaningFacts | null;
  turnUnderstandingContext: InboundTurnUnderstandingContext | null;
} {
  return {
    turnUnderstandingReconciled: ctx?.reconciled ?? null,
    inboundMeaningForPersist: ctx?.inboundMeaningForPersist ?? null,
    turnUnderstandingContext: ctx ?? null,
  };
}

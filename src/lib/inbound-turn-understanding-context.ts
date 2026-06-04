/**
 * Inbound Turn Understanding — single orchestration contract (meaning advisory; server owns truth).
 */

import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  buildInboundMeaningFacts,
  type InboundMeaningRoutePriority,
} from "@/lib/inbound-relationship-meaning";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import {
  buildInterpreterFailedSafeReconciled,
  isTurnUnderstandingAuthoritative,
  OPENAI_RELATIONSHIP_TURN_UNDERSTANDING_VERSION,
  type OpenAIRelationshipTurnUnderstandingV1,
  type ReconciledTurnUnderstanding,
  resolveInboundTurnUnderstandingSkipReason,
  runInboundRelationshipTurnUnderstanding,
  slimTurnUnderstandingMetadata,
  type RunInboundTurnUnderstandingArgs,
} from "@/lib/openai-relationship-turn-understanding-v1";

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

const STALE_ASK_STOP_WORDS = new Set([
  "your",
  "the",
  "for",
  "with",
  "that",
  "this",
  "have",
  "will",
  "when",
  "ready",
  "about",
  "from",
  "into",
  "what",
  "would",
  "could",
  "should",
  "been",
  "were",
  "they",
  "them",
  "then",
  "than",
  "also",
  "just",
  "like",
  "know",
  "tell",
  "let",
  "one",
]);

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

export function normalizeTextForStaleAskOverlap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shared overlap check — exact prefix + word overlap with question mark. */
export function substantiallyRepeatsCoachQuestion(proposedBody: string, coachLine: string): boolean {
  const p = normalizeTextForStaleAskOverlap(proposedBody);
  const c = normalizeTextForStaleAskOverlap(coachLine);
  if (c.length < 18 || p.length < 12) return false;
  const cWords = c.split(" ").filter((w) => w.length > 3);
  const pWords = new Set(p.split(" ").filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of cWords) if (pWords.has(w)) overlap++;
  const ratio = cWords.length ? overlap / cWords.length : 0;
  if (ratio >= 0.45 && /\?/.test(proposedBody)) return true;
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

/** Conservative paraphrase detection for satisfied-ask do_not_repeat phrases. */
export function paraphraseRepeatsStaleCoachAsk(proposedBody: string, coachLine: string): boolean {
  if (substantiallyRepeatsCoachQuestion(proposedBody, coachLine)) return true;

  const phraseNorm = normalizeTextForStaleAskOverlap(coachLine);
  const bodyNorm = normalizeTextForStaleAskOverlap(proposedBody);
  if (phraseNorm.length < 12 || bodyNorm.length < 12) return false;

  if (looksLikeReflectionFollowUp(proposedBody, bodyNorm)) return false;

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
        final_body_stale_ask_blocked: false,
        stale_ask_avoided: reconciled.stale_ask_avoided,
        do_not_repeat_asks: reconciled.reconciled_do_not_repeat_asks,
      },
    };
  }

  return {
    body: "",
    shouldSend: false,
    noSendReason: TURN_UNDERSTANDING_FINAL_BODY_NO_SEND,
    metadata: {
      ...baseMeta,
      turn_understanding_final_body_violation_detected: true,
      turn_understanding_final_body_repair_attempted: false,
      turn_understanding_final_body_repair_succeeded: false,
      turn_understanding_final_body_no_send_reason: TURN_UNDERSTANDING_FINAL_BODY_NO_SEND,
      final_body_stale_ask_blocked: true,
      turn_understanding_stale_ask_phrase: violation.repeatedPhrase,
      do_not_repeat_asks: reconciled.reconciled_do_not_repeat_asks,
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
    reconciled = buildInterpreterFailedSafeReconciled({
      interpreterFailedReason: reconciled.interpreter_failed_reason,
      proposal: reconciled.proposal,
      deterministicMeaning: inboundMeaningForPersist,
      latestCoachQuestion: args.latestOpenQuestion ?? args.lastCoachOutbound,
      openQuestionPending: args.openQuestionPending,
      rawInbound: args.inboundBody,
      classifierEventType: args.classifierEventType,
    });
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

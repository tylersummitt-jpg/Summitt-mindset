/**
 * Daily outbound stale-ask detect + one OpenAI repair before no-send.
 */

import {
  paraphraseRepeatsStaleCoachAsk,
} from "@/lib/inbound-turn-understanding-context";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";
import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import { detectSmsMemoryRepeatViolation } from "@/lib/sms-memory-anti-repeat";

export const DAILY_STALE_ASK_BLOCKED = "daily_stale_ask_blocked" as const;

export type DailyStaleAskDetectArgs = {
  body: string;
  satisfiedAskContext: DailySatisfiedAskContext | null | undefined;
  lastCoachQuestions?: string[];
  answeredOpenQuestion?: string | null;
  latestAnswerText?: string | null;
};

export function detectDailyStaleAskViolation(
  args: DailyStaleAskDetectArgs
): { violation: boolean; repeatedPhrase: string | null } {
  const body = args.body.trim();
  if (!body) return { violation: false, repeatedPhrase: null };

  const ctx = args.satisfiedAskContext;
  if (ctx?.has_satisfied_recent_ask) {
    for (const phrase of ctx.do_not_repeat_asks) {
      const t = phrase.trim();
      if (t.length < 12) continue;
      if (paraphraseRepeatsStaleCoachAsk(body, t)) {
        return { violation: true, repeatedPhrase: t.slice(0, 120) };
      }
    }
    const coachQ = args.answeredOpenQuestion?.trim() || null;
    if (ctx.last_ask_satisfied === "yes" && coachQ && coachQ.length >= 12) {
      if (paraphraseRepeatsStaleCoachAsk(body, coachQ)) {
        return { violation: true, repeatedPhrase: coachQ.slice(0, 120) };
      }
    }
  }

  for (const q of args.lastCoachQuestions ?? []) {
    const t = typeof q === "string" ? q.trim() : "";
    if (t.length < 12) continue;
    if (paraphraseRepeatsStaleCoachAsk(body, t)) {
      return { violation: true, repeatedPhrase: t.slice(0, 120) };
    }
  }

  const repeat = detectSmsMemoryRepeatViolation({
    candidateBody: body,
    lastCoachQuestions: args.lastCoachQuestions,
    answeredOpenQuestion: args.answeredOpenQuestion,
    latestAnswerText: args.latestAnswerText,
    doNotRepeatPhrases: ctx?.do_not_repeat_asks,
  });
  if (repeat.hasViolation && repeat.reason === "repeated_answered_open_question") {
    return {
      violation: true,
      repeatedPhrase: repeat.repeatedQuestion ?? repeat.repeatedPhrases[0]?.slice(0, 120) ?? null,
    };
  }

  return { violation: false, repeatedPhrase: null };
}

function buildDailyStaleAskRepairInstruction(args: {
  violation: { repeatedPhrase: string | null };
  context: DailySatisfiedAskContext | null | undefined;
  latestAnswerText?: string | null;
}): string {
  const dnr = args.context?.do_not_repeat_asks.slice(0, 4).join(" | ") ?? args.violation.repeatedPhrase ?? "";
  const evidence = args.context?.evidence_preview ?? args.latestAnswerText ?? "";
  return `DAILY STALE ASK REPAIR: The draft repeats a coach question the user already answered or satisfied.
Do NOT repeat or paraphrase these stale asks: ${dnr || "(prior satisfied ask)"}.
The user already answered/satisfied the prior ask. Remove the stale question entirely.
You may briefly acknowledge their latest answer if useful: ${JSON.stringify(evidence.slice(0, 200))}.
Ask one non-stale next step or outcome-close question if appropriate (e.g. did the planned action happen, or what got in the way).
Do NOT re-ask planning/scheduling/calendar setup they already gave.
Do NOT claim proof, completion, user_yes, or Victory Room saves unless server outcome evidence exists.
No hard-coded templates. One short SMS.`;
}

export type ApplyDailyStaleAskGuardArgs = DailyStaleAskDetectArgs & {
  routePurpose: string;
  factsJson?: Record<string, unknown> | null;
  stage?: string;
};

export type DailyStaleAskGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

export async function applyDailyStaleAskGuard(
  args: ApplyDailyStaleAskGuardArgs
): Promise<DailyStaleAskGuardResult> {
  const stage = args.stage ?? "daily_stale_ask_guard";
  const original = args.body.trim();
  const violation = detectDailyStaleAskViolation(args);

  const baseMeta: Record<string, unknown> = {
    daily_stale_ask_detected: violation.violation,
    daily_stale_ask_guard_stage: stage,
    ...(violation.repeatedPhrase ? { daily_stale_ask_phrase: violation.repeatedPhrase } : {}),
    daily_stale_ask_repair_attempted: false,
    daily_stale_ask_repair_succeeded: false,
  };

  if (!violation.violation) {
    return { outcome: "ok", body: original, metadata: baseMeta };
  }

  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "daily",
    routePurpose: args.routePurpose,
    originalBody: original,
    blockedReasons: ["daily_stale_ask"],
    factsJson: args.factsJson ?? null,
    systemInstruction: buildDailyStaleAskRepairInstruction({
      violation,
      context: args.satisfiedAskContext,
      latestAnswerText: args.latestAnswerText,
    }),
  });

  baseMeta.daily_stale_ask_repair_attempted = true;

  if (!repair?.body?.trim()) {
    return {
      outcome: "no_send",
      noSendReason: DAILY_STALE_ASK_BLOCKED,
      metadata: {
        ...baseMeta,
        daily_stale_ask_repair_succeeded: false,
        daily_stale_ask_no_send_reason: DAILY_STALE_ASK_BLOCKED,
      },
    };
  }

  const repairedBody = repair.body.trim();
  const recheck = detectDailyStaleAskViolation({
    ...args,
    body: repairedBody,
  });

  if (recheck.violation) {
    return {
      outcome: "no_send",
      noSendReason: DAILY_STALE_ASK_BLOCKED,
      metadata: {
        ...baseMeta,
        daily_stale_ask_repair_succeeded: false,
        daily_stale_ask_no_send_reason: DAILY_STALE_ASK_BLOCKED,
        daily_stale_ask_recheck_phrase: recheck.repeatedPhrase,
        stale_guard_repair_body_preview: repairedBody.slice(0, 220),
      },
    };
  }

  return {
    outcome: "ok",
    body: repairedBody,
    metadata: {
      ...baseMeta,
      daily_stale_ask_repair_succeeded: true,
      stale_guard_repair_body_preview: repairedBody.slice(0, 220),
    },
  };
}

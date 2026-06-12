/**
 * Daily outbound stale-ask detection with fail-closed no-send (no OpenAI rewrite).
 */

import {
  paraphraseRepeatsStaleCoachAsk,
} from "@/lib/inbound-turn-understanding-context";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";
import { detectSmsMemoryRepeatViolation } from "@/lib/sms-memory-anti-repeat";

/** Legacy lane/post-unified stale no-send token (telemetry compatibility). */
export const DAILY_STALE_ASK_BLOCKED = "daily_stale_ask_blocked" as const;

export const DAILY_LANE_STALE_ASK_BLOCKED = "daily_lane_stale_ask_blocked" as const;

/** Post-FVG stale ask: detect only — no OpenAI rewrite after voice polish. */
export const DAILY_POST_FVG_STALE_ASK_BLOCKED = "daily_post_fvg_stale_ask_blocked" as const;

export type DailyStaleAskDetectStage =
  | "daily_lane_pre_send"
  | "daily_post_final_voice_gate";

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

export type DailyStaleAskDetectOnlyArgs = DailyStaleAskDetectArgs & {
  routePurpose: string;
  stage?: DailyStaleAskDetectStage;
};

export type DailyStaleAskGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

function stageNoSendReason(stage: DailyStaleAskDetectStage): string {
  return stage === "daily_lane_pre_send"
    ? DAILY_LANE_STALE_ASK_BLOCKED
    : DAILY_POST_FVG_STALE_ASK_BLOCKED;
}

function stageSkipSource(stage: DailyStaleAskDetectStage): string {
  return stage === "daily_lane_pre_send" ? "stale_ask_no_send" : "daily_post_final_voice_gate";
}

/** Stale detection with fail-closed no-send — never rewrites the body. */
export function applyDailyStaleAskDetectOnly(
  args: DailyStaleAskDetectOnlyArgs
): DailyStaleAskGuardResult {
  const stage = args.stage ?? "daily_lane_pre_send";
  const original = args.body.trim();
  const violation = detectDailyStaleAskViolation(args);
  const noSendReason = stageNoSendReason(stage);

  const baseMeta: Record<string, unknown> = {
    daily_stale_ask_detected: violation.violation,
    daily_stale_ask_guard_stage: stage,
    daily_stale_ask_repair_attempted: false,
    daily_stale_ask_repair_succeeded: false,
    ...(stage === "daily_lane_pre_send"
      ? {
          daily_lane_stale_ask_detected: violation.violation,
          daily_lane_stale_ask_source: stage,
          daily_lane_stale_ask_repair_attempted: false,
        }
      : {
          daily_post_fvg_stale_ask_detected: violation.violation,
          daily_post_fvg_stale_ask_source: stage,
          daily_post_fvg_stale_ask_repair_attempted: false,
        }),
    ...(violation.repeatedPhrase
      ? {
          daily_stale_ask_phrase: violation.repeatedPhrase,
          ...(stage === "daily_lane_pre_send"
            ? { daily_lane_stale_ask_phrase: violation.repeatedPhrase }
            : { daily_post_fvg_stale_ask_phrase: violation.repeatedPhrase }),
        }
      : {}),
  };

  if (!violation.violation) {
    return { outcome: "ok", body: original, metadata: baseMeta };
  }

  return {
    outcome: "no_send",
    noSendReason,
    metadata: {
      ...baseMeta,
      daily_stale_ask_no_send_reason: noSendReason,
      ...(stage === "daily_lane_pre_send"
        ? { daily_lane_stale_ask_no_send_reason: noSendReason }
        : { daily_post_fvg_stale_ask_no_send_reason: noSendReason }),
      skip_source: stageSkipSource(stage),
    },
  };
}

/** After FVG: stale detection with fail-closed no-send — never rewrites the body. */
export function applyDailyPostFvgStaleAskDetectOnly(
  args: DailyStaleAskDetectArgs & { routePurpose: string; stage?: string }
): DailyStaleAskGuardResult {
  return applyDailyStaleAskDetectOnly({
    ...args,
    stage: (args.stage as DailyStaleAskDetectStage | undefined) ?? "daily_post_final_voice_gate",
  });
}

/**
 * V3 SMS Brain — turn routing for open-question answers (Phase 3).
 * Server-verified; does not replace V2 accountability spine event writes by default.
 */

import type { ExpectedReplySemanticsV3 } from "@/lib/north-star-sms-context-packet";

export type V3AnswerToOpenQuestionSubkind =
  | "future_plan_story_title"
  | "time_or_schedule"
  | "discrete_choice"
  | "blocker_detail"
  | "goal_change_clarification"
  | "open_reflection"
  | "unknown_open_answer"
  /** User defers smallest-step-today to tomorrow / late — must not repeat the same today question. */
  | "defer_today_micro_step_to_tomorrow";

export type V3AnswerToOpenQuestionResult = {
  turnPurpose: "answer_to_open_question";
  subkind: V3AnswerToOpenQuestionSubkind;
  answeredOpenQuestion: true;
  extractedAnswer?: string;
  shouldWriteOutcomeEvent: false;
  shouldAskTodayCompletionAgain: false;
  replyStrategy: string;
};

export type TryResolveAnswerToOpenQuestionArgs = {
  inboundRaw: string;
  latestOpenQuestion: string | null;
  expectedReplySemantics: ExpectedReplySemanticsV3;
  recentTranscriptLines: string[];
  todayCompleted: boolean;
  effectiveAsk: string;
  behaviorStatement: string;
};

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Strip coach/user prefixes from transcript lines for lightweight checks. */
function parseTranscriptRoleLine(line: string): { role: "Coach" | "User" | null; text: string } {
  const mCoach = /^\s*Coach:\s*(.+)$/i.exec(line);
  if (mCoach?.[1]) return { role: "Coach", text: norm(mCoach[1]) };
  const mUser = /^\s*User:\s*(.+)$/i.exec(line);
  if (mUser?.[1]) return { role: "User", text: norm(mUser[1]) };
  return { role: null, text: norm(line) };
}

function inboundLooksLikeStrongAccountabilityOnly(raw: string): boolean {
  const t = raw.trim();
  if (t.length <= 24) {
    if (/^(yes|y|yeah|yep|yup|no|n|nope|nah)\b/i.test(t)) return true;
    if (/^(done|got it|finished|sure\s+did)\b/i.test(t)) return true;
  }
  return false;
}

function extractTimeAnswer(raw: string): string | null {
  const t = raw.trim();
  const m =
    t.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i) ||
    t.match(/\b(\d{1,2}\s*(?:am|pm))\b/i) ||
    t.match(/\b(noon|midnight)\b/i);
  return m?.[1] ? m[1].trim() : null;
}

/** Prefer time windows (9-11am) over collapsing to the last instant in the range. */
export function extractTimeOrRangeAnswer(raw: string): string | null {
  const t = raw.trim();
  const rangeCompact = t.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (rangeCompact?.[1]) return rangeCompact[1].replace(/\s+/g, " ").trim();
  const between = t.match(
    /\b(between\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+and\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (between?.[1]) return between[1].replace(/\s+/g, " ").trim();
  const spaced = t.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+to\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (spaced?.[1]) return spaced[1].replace(/\s+/g, " ").trim();
  const bareWordTo = t.match(/\b(\d{1,2}(?::\d{2})?\s+to\s+\d{1,2}(?::\d{2})?)\b/i);
  if (bareWordTo?.[1]) return bareWordTo[1].replace(/\s+/g, " ").trim();
  return extractTimeAnswer(raw);
}

/**
 * Single-token bare hour (1–12). Only used inside {@link tryResolveAnswerToOpenQuestionTurn}
 * when expected semantics are already time_or_schedule — not global numeric parsing.
 */
export function extractBareHourTimeAnswer(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const hour = Number.parseInt(t, 10);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null;
  return t;
}

function matchesDiscreteChoice(raw: string, question: string): boolean {
  const q = question.toLowerCase();
  const t = raw.trim().toLowerCase();
  if (/time,\s*energy,\s*or\s*avoidance/i.test(q)) {
    return /^(time|energy|avoidance)\b/i.test(t) || /\b(time|energy|avoidance)\b/i.test(t);
  }
  return false;
}

function looksLikeStoryTitleAnswer(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (/^(yes|no|yep|nope)\b/i.test(t) && t.length <= 8) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;
  if (/\b(because|since|although|however)\b/i.test(t) && t.length > 40) return false;
  return true;
}

function looksLikeBlockerPhrase(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2 || t.length > 160) return false;
  return true;
}

/** Coach asked for a tiny/today micro-commit (matches smallest-step deterministic reply). */
export function coachAskedSmallestStepToday(latestQuestion: string): boolean {
  const q = latestQuestion.toLowerCase();
  return (
    /\bsmallest\s+honest\s+next\s+step\b/i.test(q) ||
    /\b10\s*minutes\s+or\s+less\b/i.test(q) ||
    /\bstill\s+do\s+today\b/i.test(q) ||
    (/\btoday\b/i.test(q) && /\b10\b.*\bminute/i.test(q))
  );
}

/** User closes today and points to tomorrow / late — answers the micro-step question without taking more today. */
export function inboundDefersTodayForTomorrow(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return (
    /\b(tomorrow|tmrw)\b/.test(t) ||
    /\b(it'?s\s+late|too\s+late|kind\s+of\s+late)\b/.test(t) ||
    /\b(can'?t\s+tonight|not\s+tonight|no\s+time\s+tonight)\b/.test(t) ||
    /\b(not\s+today|won'?t\s+happen\s+today)\b/.test(t) ||
    /\b(get\s+it\s+done\s+tomorrow|done\s+tomorrow|do\s+it\s+tomorrow|have\s+to\s+[^.!?]*tomorrow)\b/i.test(t)
  );
}

/**
 * If the latest coach message asked an open question and inbound plausibly answers it,
 * route here instead of legacy user_partial / accountability templates.
 */
export function tryResolveAnswerToOpenQuestionTurn(
  args: TryResolveAnswerToOpenQuestionArgs
): V3AnswerToOpenQuestionResult | null {
  const inbound = args.inboundRaw.trim();
  if (!inbound || !args.latestOpenQuestion?.trim()) return null;

  const qSem = args.expectedReplySemantics;

  if (qSem === "proposal_yes_no") return null;

  if (qSem === "accountability_check") {
    return null;
  }

  if (inboundLooksLikeStrongAccountabilityOnly(inbound) && qSem !== "discrete_choice") {
    return null;
  }

  const lo = args.latestOpenQuestion.trim();

  if (coachAskedSmallestStepToday(lo) && inboundDefersTodayForTomorrow(inbound)) {
    return {
      turnPurpose: "answer_to_open_question",
      subkind: "defer_today_micro_step_to_tomorrow",
      answeredOpenQuestion: true,
      extractedAnswer: inbound,
      shouldWriteOutcomeEvent: false,
      shouldAskTodayCompletionAgain: false,
      replyStrategy: "tomorrow_concrete_time_after_micro_step_declined",
    };
  }

  switch (qSem) {
    case "future_plan_story_title": {
      if (/^(why|how come|what do you mean)\b/i.test(inbound.trim())) return null;
      if (!looksLikeStoryTitleAnswer(inbound)) return null;
      return {
        turnPurpose: "answer_to_open_question",
        subkind: "future_plan_story_title",
        answeredOpenQuestion: true,
        extractedAnswer: inbound,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_tomorrow_story_title",
      };
    }
    case "time_or_schedule": {
      const timeAns = extractTimeOrRangeAnswer(inbound) ?? extractBareHourTimeAnswer(inbound);
      if (!timeAns && inbound.length > 36) return null;
      if (!timeAns && !/\b(tomorrow|am|pm|morning|evening|night)\b/i.test(inbound)) return null;
      return {
        turnPurpose: "answer_to_open_question",
        subkind: "time_or_schedule",
        answeredOpenQuestion: true,
        extractedAnswer: timeAns ?? inbound,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_block_time",
      };
    }
    case "discrete_choice": {
      if (!matchesDiscreteChoice(inbound, lo)) return null;
      const extracted = inbound.match(/\b(time|energy|avoidance)\b/i)?.[1]?.toLowerCase() ?? inbound.trim();
      return {
        turnPurpose: "answer_to_open_question",
        subkind: "discrete_choice",
        answeredOpenQuestion: true,
        extractedAnswer: extracted,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "narrow_blocker_choice",
      };
    }
    case "blocker_detail":
    case "open_reflection": {
      if (!looksLikeBlockerPhrase(inbound)) return null;
      return {
        turnPurpose: "answer_to_open_question",
        subkind: qSem === "blocker_detail" ? "blocker_detail" : "open_reflection",
        answeredOpenQuestion: true,
        extractedAnswer: inbound,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "ack_blocker_detail",
      };
    }
    case "goal_change_clarification": {
      if (inbound.length < 8) return null;
      return {
        turnPurpose: "answer_to_open_question",
        subkind: "goal_change_clarification",
        answeredOpenQuestion: true,
        extractedAnswer: inbound,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "goal_change_ack",
      };
    }
    case "unknown": {
      if (args.todayCompleted && /\?/.test(lo) && looksLikeStoryTitleAnswer(inbound)) {
        return {
          turnPurpose: "answer_to_open_question",
          subkind: "unknown_open_answer",
          answeredOpenQuestion: true,
          extractedAnswer: inbound,
          shouldWriteOutcomeEvent: false,
          shouldAskTodayCompletionAgain: false,
          replyStrategy: "generic_open_answer_after_proof",
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function sidPick(messageSid: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < messageSid.length; i++) h = (h * 31 + messageSid.charCodeAt(i)) >>> 0;
  return h % modulo;
}

function titleCasePreserve(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.replace(/\s+/g, " ");
}

/**
 * Deterministic V3 reply for answered open questions — North Star runs after for hygiene.
 */
export function generateV3OpenQuestionAnswerReply(args: {
  v3: V3AnswerToOpenQuestionResult;
  messageSid: string;
  todayCompleted: boolean;
  effectiveAsk: string;
}): string {
  const { v3, messageSid } = args;
  const ans = titleCasePreserve(v3.extractedAnswer ?? "");

  switch (v3.subkind) {
    case "defer_today_micro_step_to_tomorrow": {
      const lines = [
        `Fair — tonight is closed. Tomorrow starts with the first 10 minutes before anything else. What time are you protecting?`,
        `Got it — no more negotiating tonight. Tomorrow: first 10 minutes before the product pulls you in. What time does it start?`,
        `Then today is done. Tomorrow gets concrete — what time are you protecting for the first 10 minutes?`,
      ];
      return lines[sidPick(messageSid, lines.length)]!;
    }
    case "future_plan_story_title": {
      const lines = [
        `Good. ${ans} is tomorrow's story. Get the first rough version down — messy is fine.`,
        `Good. ${ans} goes next tomorrow. When will you dictate the first rough version?`,
      ];
      return lines[sidPick(messageSid, lines.length)]!;
    }
    case "time_or_schedule": {
      const rawAns = (v3.extractedAnswer ?? "").trim();
      const looksLikeWindow =
        /\d\s*[-–—]\s*\d/i.test(rawAns) ||
        /\bbetween\s+\d/i.test(rawAns) ||
        /\b\d{1,2}(?::\d{2})?\s+to\s+\d{1,2}(?::\d{2})?\b/i.test(rawAns);
      if (looksLikeWindow) {
        return `Good. ${rawAns} is the window. Start at the first time you named.`;
      }
      return `Good — ${ans} is on the calendar. Treat it like a hard start, not a suggestion.`;
    }
    case "discrete_choice": {
      const topic = v3.extractedAnswer?.toLowerCase().includes("avoidance")
        ? "Avoidance"
        : v3.extractedAnswer?.toLowerCase().includes("energy")
          ? "Energy"
          : "Time";
      return `${topic} — thanks for naming it. What's one tiny move that happens before the excuse shows up?`;
    }
    case "blocker_detail":
    case "open_reflection": {
      /** Emergency-only — primary path is OpenAI (`tryGenerateV3OpenQuestionCoachReply` in v3-sms-brain). */
      return `Noted. What's the tightest constraint — time, energy, or avoidance?`;
    }
    case "goal_change_clarification": {
      return `Noted. Say this plainly: do you want a one-day experiment, or are you asking to change the daily standard?`;
    }
    case "unknown_open_answer": {
      return `Good. Lock ${ans} as the next target — first draft beats a perfect plan.`;
    }
    default:
      return `Good. Let's keep the next move concrete and small.`;
  }
}

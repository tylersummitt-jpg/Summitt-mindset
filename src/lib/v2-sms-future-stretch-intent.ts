/**
 * Future / stretch planning signals for inbound SMS — coaching turns that must not
 * be scored as today's yes/no/partial and must not get accountability-machinery replies.
 */

import { naturalizeCommitmentForSms } from "@/lib/v2-sms-accountability";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

export type InboundFutureStretchClassification =
  | { kind: "future_stretch_target"; hasExplicitTomorrow: boolean }
  | { kind: "goal_increase_vague" }
  | { kind: "none" };

function sidPick(messageSid: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < messageSid.length; i++) h = (h * 31 + messageSid.charCodeAt(i)) >>> 0;
  return h % modulo;
}

/** User is clearly talking about a future window (tomorrow / next week), not answering today's check. */
export function isFutureForwardPlanInbound(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  const hasFutureWindow = /\b(tomorrow|tmrw|next\s+week)\b/i.test(lower);
  if (!hasFutureWindow) return false;

  // Literal accountability answers that happen to mention tomorrow elsewhere — keep scoring path.
  if (/^\s*(yes|y|yeah|yep|yup|no|n|nope|nah)\s*[!.]?\s*$/i.test(t)) return false;

  const planLike =
    /\b(\d+\s*(hours?|hrs?|minutes?|mins?)|going\s+for|i\s*'?m\s+going\s+for|i\s*'?m\s+doing|i\s*'?ll\s+do|doing\s+\d+|full\s+hour|two\s+stories|make\s+it\s+\d+)\b/i.test(
      lower
    ) ||
    /\bincrease\s+(the\s+)?goal\b/i.test(lower) ||
    /\braise\s+(the\s+)?goal\b/i.test(lower) ||
    /\bpush\s+harder\b/i.test(lower) ||
    /\bready\s+to\s+push\b/i.test(lower) ||
    /\bmore\s+tomorrow\b/i.test(lower);

  return planLike;
}

export function isGoalIncreaseIntentClarifyInbound(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/\b(tomorrow|tmrw|next\s+week)\b/i.test(lower)) return false;
  return (
    /\b(increase|raise)\s+(the\s+)?goal\b/i.test(lower) ||
    /\b(let'?s|let\s+us)\s+increase\s+(the\s+)?goal\b/i.test(lower) ||
    /\bi\s+want\s+to\s+(increase|raise)\s+(the\s+)?goal\b/i.test(lower)
  );
}

export function classifyInboundFutureStretchAndGoalIntent(raw: string): InboundFutureStretchClassification {
  if (isFutureForwardPlanInbound(raw)) {
    return {
      kind: "future_stretch_target",
      hasExplicitTomorrow: /\b(tomorrow|tmrw)\b/i.test(raw),
    };
  }
  if (isGoalIncreaseIntentClarifyInbound(raw)) {
    return { kind: "goal_increase_vague" };
  }
  return { kind: "none" };
}

export function lastOutboundHintsTomorrowFollowup(preview: string | null | undefined): boolean {
  if (!preview?.trim()) return false;
  const p = preview.toLowerCase();
  return (
    /\b(tomorrow|tomorrow'?s|next\s+day)\b/.test(p) ||
    /\bplan\s+for\s+tomorrow\b/.test(p) ||
    /\bwhat'?s\s+the\s+plan\b/.test(p) ||
    /\bnext\s+day\b/.test(p)
  );
}

/** Latest scored accountability outcome among recent events (yes/no/partial). */
export function recentEventsLatestOutcomeType(
  eventsNewestFirst: V2EventRowForAi[]
): "user_yes" | "user_no" | "user_partial" | null {
  for (const e of eventsNewestFirst) {
    const t = e.event_type;
    if (t === "user_yes" || t === "user_no" || t === "user_partial") return t;
  }
  return null;
}

function extractStretchHoursPhrase(message: string): string | null {
  const m = message.match(/\b(\d+)\s*(hours?|hrs?)\b/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return `${n} protected hour${n === 1 ? "" : "s"}`;
}

export function buildFutureStretchCoachReplyDeterministic(args: {
  userMessage: string;
  effectiveAskFloor: string;
  messageSid: string;
}): string {
  const floor = naturalizeCommitmentForSms(args.effectiveAskFloor, 52);
  const stretch = extractStretchHoursPhrase(args.userMessage);
  const stretchText = stretch ?? "that bigger block";

  const lines = [
    `Good. Keep ${floor} as the floor—tomorrow’s stretch is ${stretchText}. What exact block are you calendar-protecting?`,
    `That’s the right instinct—don’t let it stay a mood. Tomorrow’s target is ${stretchText}. What time does the first rep start?`,
    `Locked on tomorrow: ${stretchText}. Keep ${floor} as base unless you explicitly change the daily commitment—what’s the first concrete step when you wake up?`,
  ];
  return lines[sidPick(args.messageSid, lines.length)]!;
}

export function buildGoalIncreaseStretchVsDurableReply(messageSid: string): string {
  const lines = [
    "Good. Two paths: one-day stretch (tomorrow only), or a new daily floor you want locked in. Which one are you asking for?",
    "I’m not shutting that down—do you want tomorrow’s stretch bigger, or are you asking to raise the official daily bar?",
    "Say it plainly: bigger push tomorrow only, or rewrite the daily commitment going forward?",
  ];
  return lines[sidPick(messageSid, lines.length)]!;
}

export function tryBuildForcedInboundCoachSms(args: {
  userMessage: string;
  gatedDecision: { mode: string; decision_reason: string };
  lastOutboundSmsPreview: string | null;
  eventsNewestFirst: V2EventRowForAi[];
  effectiveAskFloor: string;
  messageSid: string;
}): string | null {
  const raw = args.userMessage.trim();
  const reason = args.gatedDecision.decision_reason;

  if (reason === "future_forward_plan_no_today_score") {
    return buildFutureStretchCoachReplyDeterministic({
      userMessage: raw,
      effectiveAskFloor: args.effectiveAskFloor,
      messageSid: args.messageSid,
    });
  }

  if (reason === "goal_increase_intent_clarify_stretch_vs_durable") {
    return buildGoalIncreaseStretchVsDurableReply(args.messageSid);
  }

  // Belt-and-suspenders: commitment-change handoff + explicit tomorrow stretch slipped past routing.
  const classified = classifyInboundFutureStretchAndGoalIntent(raw);
  if (
    classified.kind === "future_stretch_target" &&
    args.gatedDecision.mode === "commitment_change_handoff" &&
    (lastOutboundHintsTomorrowFollowup(args.lastOutboundSmsPreview) ||
      recentEventsLatestOutcomeType(args.eventsNewestFirst) === "user_yes")
  ) {
    return buildFutureStretchCoachReplyDeterministic({
      userMessage: raw,
      effectiveAskFloor: args.effectiveAskFloor,
      messageSid: args.messageSid,
    });
  }

  return null;
}

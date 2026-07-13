/**
 * SlotCoachingContextV1 — interpretive two-slot coaching thread guidance for daily writer brief.
 * Not proof authority; not mandatory send rules. Server owns truth/skip; OpenAI writes SMS.
 */

import {
  extractCompletionDisqualifiers,
  hasFuturePlanIntentLanguage,
  looksLikeReportedCompletion,
  type PendingPlanProofFact,
} from "@/lib/pending-plan-proof";
import type { DailySilenceCadenceFacts } from "@/lib/sms-silence-cadence-v1";
import { silenceCadenceOverridesOldSilenceRouting } from "@/lib/sms-silence-cadence-v1";
import type { SmsDailySendSlot } from "@/lib/tyler-text-overview-types";

export const SLOT_COACHING_CONTEXT_VERSION = "1" as const;

export type SlotCoachingThreadMessage = {
  at_local: string;
  role: "coach" | "user";
  body: string;
};

export type SlotCoachingRoleRecommendation =
  | "set_today_rep"
  | "check_prior_rep"
  | "check_user_plan"
  | "name_blocker"
  | "reset_after_miss"
  | "bedtime_setup"
  | "wake_up_check"
  | "truth_check"
  | "skip"
  | "relationship_reentry";

export type SlotCoachingSendRecommendation = "send" | "skip" | "writer_decides";

export type SlotCoachingDailyOutcomeStatus =
  | "none"
  | "proof_received"
  | "miss_reported"
  | "partial_reported"
  | "plan_ack_only";

export const SLOT_COACHING_CONTEXT_AUTHORITY = "paraphrase_only_not_copy" as const;

export type SlotCoachingContextV1 = {
  version: typeof SLOT_COACHING_CONTEXT_VERSION;
  authority: typeof SLOT_COACHING_CONTEXT_AUTHORITY;
  current_slot: SmsDailySendSlot;
  previous_slot: SmsDailySendSlot | null;
  previous_outbound_summary: string | null;
  user_replies_since_previous_outbound: string | null;
  active_coaching_thread: string | null;
  slot_role_recommendation: SlotCoachingRoleRecommendation;
  checkin_focus: string | null;
  should_send_recommendation: SlotCoachingSendRecommendation;
  skip_reason_hint: string | null;
};

const CAP = {
  previous_outbound_summary: 160,
  user_replies_since_previous_outbound: 200,
  active_coaching_thread: 200,
  checkin_focus: 160,
  skip_reason_hint: 120,
} as const;

const PLAN_ASK_RE =
  /\b(what'?s your plan|what is your plan|what'?s the plan|plan for today|how will you|when will you|what time|tell me your plan)\b/i;

const BLOCKER_RE =
  /\b(blocker|gets in the way|what got in the way|before the house|before it gets|beat it early| obstacle)\b/i;

const BEDTIME_SETUP_RE =
  /\b(get to bed|shut it down|shut down|bedtime|in bed by|asleep by|wind down|lights out)\b/i;

const WAKE_SETUP_RE =
  /\b(set the alarm|set your alarm|wake up|wake early|5 am|5am|without snooz|alarm now|up at \d)\b/i;

const BEDTIME_CHECK_RE =
  /\b(bedtime|in bed|asleep|shut down|wind down|lights out|get to bed)\b/i;

const WAKE_CHECK_RE = /\b(wake|alarm|snooz|got up|up at \d|morning routine)\b/i;

const CONCRETE_REP_RE =
  /\b(today'?s rep|your rep|one real|before bedtime|concrete|first move|one honest)\b/i;

const MISS_RE =
  /\b(didn'?t|did not|missed|not yet|no\b|failed|couldn'?t|could not|partial|almost)\b/i;

const PROOF_RE =
  /\b(done|finished|completed|got it|did it|yes\b|hit it|made it|proof)\b/i;

const GENERIC_GOAL_ASK_RE = /\bdid you hit your goal\b/i;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function looksLikePlanTimingAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasFuturePlanIntentLanguage(t)) return true;
  if (/^after\s+\S/i.test(t)) return true;
  if (/^(this (morning|afternoon|evening)|tonight|before bed|at \d)/i.test(t)) return true;
  return false;
}

function looksLikeSlotCoachingProof(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasFuturePlanIntentLanguage(t)) return false;
  if (extractCompletionDisqualifiers(t).length > 0) return false;
  if (looksLikeReportedCompletion(t)) return true;
  if (/\bdone\b/i.test(t) && (PROOF_RE.test(t) || /\b(kids|steps|workout|each)\b/i.test(t))) {
    return true;
  }
  return PROOF_RE.test(t) && !MISS_RE.test(t);
}

function summarizeOutbound(body: string): string {
  return clip(body.replace(/\s+/g, " "), CAP.previous_outbound_summary);
}

function summarizeUserReplies(replies: string[]): string {
  if (!replies.length) return "";
  const joined = replies.map((r) => r.trim()).filter(Boolean).join(" | ");
  return clip(joined, CAP.user_replies_since_previous_outbound);
}

export type SlotCoachingPreviousOutbound = {
  body: string;
  at_local?: string | null;
  inferred_slot?: SmsDailySendSlot | null;
};

export type BuildSlotCoachingContextArgs = {
  currentSlot: SmsDailySendSlot;
  previousOutbound?: SlotCoachingPreviousOutbound | null;
  userRepliesSincePreviousOutbound?: string[];
  recentExactThread?: SlotCoachingThreadMessage[];
  pendingPlanProof?: PendingPlanProofFact | null;
  timingAnchorMemory?: unknown | null;
  dailyOutcomeStatus?: SlotCoachingDailyOutcomeStatus;
  silenceCadence?: DailySilenceCadenceFacts | null;
  effectiveAsk?: string | null;
  goalTypeHint?: string | null;
  openQuestionPending?: boolean;
  latestOpenQuestion?: string | null;
};

export function inferPreviousSlotFromOutboundBody(body: string): SmsDailySendSlot | null {
  const b = body.trim();
  if (!b) return null;
  if (BEDTIME_SETUP_RE.test(b) || WAKE_SETUP_RE.test(b)) return "evening_checkin";
  if (/\b(how did today|how was today|didn'?t hear from you|this morning)\b/i.test(b)) {
    return "evening_checkin";
  }
  if (/\b(today'?s rep|this morning|start today|fresh day)\b/i.test(b)) return "morning";
  return null;
}

export function extractPreviousOutboundFromThread(
  messages: SlotCoachingThreadMessage[]
): SlotCoachingPreviousOutbound | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== "coach" || !m.body.trim()) continue;
    return {
      body: m.body.trim(),
      at_local: m.at_local ?? null,
      inferred_slot: inferPreviousSlotFromOutboundBody(m.body),
    };
  }
  return null;
}

export function extractUserRepliesSincePreviousOutbound(
  messages: SlotCoachingThreadMessage[],
  previousOutboundBody: string | null | undefined
): string[] {
  if (!messages.length) return [];
  let startIdx = 0;
  if (previousOutboundBody?.trim()) {
    const needle = previousOutboundBody.trim().slice(0, 80).toLowerCase();
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === "coach" && m.body.trim().toLowerCase().includes(needle.slice(0, 40))) {
        startIdx = i + 1;
        break;
      }
    }
  } else {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "coach") {
        startIdx = i + 1;
        break;
      }
    }
  }
  const out: string[] = [];
  for (let i = startIdx; i < messages.length; i += 1) {
    const m = messages[i]!;
    if (m.role === "user" && m.body.trim()) out.push(m.body.trim());
  }
  return out;
}

function classifyUserOutcome(replies: string[]): SlotCoachingDailyOutcomeStatus {
  if (!replies.length) return "none";
  const latest = replies[replies.length - 1] ?? "";
  if (looksLikeSlotCoachingProof(latest)) return "proof_received";
  if (/\b(partial|almost|sort of|half)\b/i.test(latest)) return "partial_reported";
  if (MISS_RE.test(latest) && !hasFuturePlanIntentLanguage(latest)) return "miss_reported";
  if (
    /^(will do|ok|okay|got it|sure|yes sir|on it)\.?$/i.test(latest.trim()) ||
    hasFuturePlanIntentLanguage(latest)
  ) {
    return "plan_ack_only";
  }
  return "none";
}

function extractConcreteRepFocus(outboundBody: string): string | null {
  const b = outboundBody.trim();
  if (!b) return null;
  const repMatch = b.match(/today'?s rep[^:]*:\s*([^.?!]+)/i);
  if (repMatch?.[1]) return clip(repMatch[1], CAP.checkin_focus);
  if (CONCRETE_REP_RE.test(b)) return summarizeOutbound(b);
  return null;
}

function extractBlockerFocus(outboundBody: string): string | null {
  const b = outboundBody.trim();
  if (!BLOCKER_RE.test(b)) return null;
  const m = b.match(/blocker[^.?!]*[:\s]+([^.?!]+)/i);
  if (m?.[1]) return clip(m[1], CAP.checkin_focus);
  return summarizeOutbound(b);
}

function buildCheckinFocus(args: {
  previousBody: string | null;
  userReplies: string[];
  pendingPlanProof: PendingPlanProofFact | null | undefined;
  effectiveAsk: string | null | undefined;
}): string | null {
  if (args.pendingPlanProof?.active) {
    const hint =
      args.pendingPlanProof.plan_summary_hint?.trim() ||
      args.pendingPlanProof.source_answer_preview?.trim();
    if (hint) return clip(hint, CAP.checkin_focus);
  }
  const latestReply = args.userReplies[args.userReplies.length - 1]?.trim();
  if (latestReply && (hasFuturePlanIntentLanguage(latestReply) || looksLikePlanTimingAnswer(latestReply))) {
    return clip(latestReply, CAP.checkin_focus);
  }
  if (args.previousBody) {
    const rep = extractConcreteRepFocus(args.previousBody);
    if (rep) return rep;
    const blocker = extractBlockerFocus(args.previousBody);
    if (blocker) return blocker;
    if (BEDTIME_SETUP_RE.test(args.previousBody) || BEDTIME_CHECK_RE.test(args.previousBody)) {
      return clip("Get to bed on time", CAP.checkin_focus);
    }
    if (WAKE_SETUP_RE.test(args.previousBody) || WAKE_CHECK_RE.test(args.previousBody)) {
      return clip("Wake up / alarm", CAP.checkin_focus);
    }
  }
  const ask = args.effectiveAsk?.trim();
  if (ask && !GENERIC_GOAL_ASK_RE.test(ask)) return clip(ask, CAP.checkin_focus);
  return null;
}

function recommendRole(args: {
  currentSlot: SmsDailySendSlot;
  previousSlot: SmsDailySendSlot | null;
  previousBody: string | null;
  userReplies: string[];
  outcome: SlotCoachingDailyOutcomeStatus;
  pendingPlanProof: PendingPlanProofFact | null | undefined;
  silenceCadence: DailySilenceCadenceFacts | null | undefined;
  openQuestionPending: boolean;
  latestOpenQuestion: string | null | undefined;
}): SlotCoachingRoleRecommendation {
  const sc = args.silenceCadence;
  if (sc && silenceCadenceOverridesOldSilenceRouting(sc) && sc.route !== "normal_daily") {
    return "relationship_reentry";
  }

  if (args.outcome === "proof_received") return "skip";

  if (args.outcome === "miss_reported" || args.outcome === "partial_reported") {
    return args.currentSlot === "morning" ? "reset_after_miss" : "truth_check";
  }

  const prev = args.previousBody?.trim() ?? "";
  const latestReply = args.userReplies[args.userReplies.length - 1]?.trim() ?? "";
  const planAskOutbound = PLAN_ASK_RE.test(prev) || PLAN_ASK_RE.test(args.latestOpenQuestion ?? "");

  if (args.currentSlot === "morning") {
    if (prev && (BEDTIME_SETUP_RE.test(prev) || BEDTIME_CHECK_RE.test(prev))) {
      return "truth_check";
    }
    if (prev && (WAKE_SETUP_RE.test(prev) || WAKE_CHECK_RE.test(prev))) {
      return "wake_up_check";
    }
  }

  if (args.pendingPlanProof?.active || (latestReply && looksLikePlanTimingAnswer(latestReply))) {
    return "check_user_plan";
  }

  if (planAskOutbound && latestReply) {
    return "check_user_plan";
  }

  if ((args.openQuestionPending || planAskOutbound) && !latestReply) {
    return "truth_check";
  }

  if (BLOCKER_RE.test(prev)) return "check_prior_rep";

  if (prev && (CONCRETE_REP_RE.test(prev) || extractConcreteRepFocus(prev))) {
    return "check_prior_rep";
  }

  if (args.currentSlot === "evening_checkin" && prev) {
    return "check_prior_rep";
  }

  if (prev && WAKE_SETUP_RE.test(prev) && args.currentSlot === "evening_checkin") {
    return "bedtime_setup";
  }

  if (!prev) return "set_today_rep";

  return "set_today_rep";
}

function buildActiveThread(args: {
  currentSlot: SmsDailySendSlot;
  previousSlot: SmsDailySendSlot | null;
  previousSummary: string | null;
  userRepliesSummary: string | null;
  outcome: SlotCoachingDailyOutcomeStatus;
  role: SlotCoachingRoleRecommendation;
  focus: string | null;
  pendingPlanProof: PendingPlanProofFact | null | undefined;
  openQuestionPending: boolean;
}): string | null {
  const parts: string[] = [];

  if (args.outcome === "proof_received") {
    return clip("User already gave proof after the last outbound; day may be resolved.", CAP.active_coaching_thread);
  }

  if (args.previousSummary) {
    parts.push(`Last coach (${args.previousSlot ?? "unknown slot"}): ${args.previousSummary}`);
  }

  if (args.userRepliesSummary) {
    parts.push(`User since then: ${args.userRepliesSummary}`);
  } else if (args.openQuestionPending || args.role === "truth_check") {
    parts.push("No user reply since the last outbound.");
  }

  if (args.outcome === "plan_ack_only") {
    parts.push("User acknowledged plan; outcome not proven yet.");
  }

  if (args.pendingPlanProof?.active) {
    parts.push("Pending plan awaiting outcome proof.");
  }

  if (args.focus && !GENERIC_GOAL_ASK_RE.test(args.focus) && args.outcome !== "plan_ack_only") {
    parts.push(`Thread focus: ${args.focus}`);
  } else if (args.role === "set_today_rep") {
    parts.push("Fresh day — set a concrete rep or move, not a generic goal loop.");
  }

  if (args.outcome === "miss_reported") {
    parts.push("User reported a miss — reset from that truth.");
  }

  if (!parts.length) return null;
  return clip(parts.join(" "), CAP.active_coaching_thread);
}

function recommendSend(args: {
  role: SlotCoachingRoleRecommendation;
  outcome: SlotCoachingDailyOutcomeStatus;
  silenceCadence: DailySilenceCadenceFacts | null | undefined;
  currentSlot: SmsDailySendSlot;
}): { should_send_recommendation: SlotCoachingSendRecommendation; skip_reason_hint: string | null } {
  const sc = args.silenceCadence;
  if (sc && !sc.send_today) {
    return {
      should_send_recommendation: "skip",
      skip_reason_hint: clip(sc.no_send_reason ?? "silence_cadence_no_send", CAP.skip_reason_hint),
    };
  }

  if (args.outcome === "proof_received" && args.currentSlot === "evening_checkin") {
    return {
      should_send_recommendation: "skip",
      skip_reason_hint: clip("proof already received after prior outbound", CAP.skip_reason_hint),
    };
  }

  if (args.role === "skip") {
    return {
      should_send_recommendation: "skip",
      skip_reason_hint: clip("slot role recommends skip", CAP.skip_reason_hint),
    };
  }

  if (sc && silenceCadenceOverridesOldSilenceRouting(sc) && sc.route !== "normal_daily") {
    return {
      should_send_recommendation: "writer_decides",
      skip_reason_hint: clip("silence cadence owns relationship pressure this slot", CAP.skip_reason_hint),
    };
  }

  return { should_send_recommendation: "writer_decides", skip_reason_hint: null };
}

export function buildSlotCoachingContext(args: BuildSlotCoachingContextArgs): SlotCoachingContextV1 {
  const thread = args.recentExactThread ?? [];
  const previousFromThread = args.previousOutbound ?? extractPreviousOutboundFromThread(thread);
  const previousBody = previousFromThread?.body?.trim() ?? null;
  const previousSummary = previousBody ? summarizeOutbound(previousBody) : null;
  const previousSlot =
    previousFromThread?.inferred_slot ?? (previousBody ? inferPreviousSlotFromOutboundBody(previousBody) : null);

  const userReplies =
    args.userRepliesSincePreviousOutbound ??
    extractUserRepliesSincePreviousOutbound(thread, previousBody);

  const userRepliesSummary = summarizeUserReplies(userReplies);

  const outcome =
    args.dailyOutcomeStatus && args.dailyOutcomeStatus !== "none"
      ? args.dailyOutcomeStatus
      : classifyUserOutcome(userReplies);

  const role = recommendRole({
    currentSlot: args.currentSlot,
    previousSlot,
    previousBody,
    userReplies,
    outcome,
    pendingPlanProof: args.pendingPlanProof,
    silenceCadence: args.silenceCadence,
    openQuestionPending: args.openQuestionPending === true,
    latestOpenQuestion: args.latestOpenQuestion,
  });

  const checkin_focus = buildCheckinFocus({
    previousBody,
    userReplies,
    pendingPlanProof: args.pendingPlanProof,
    effectiveAsk: args.effectiveAsk,
  });

  const active_coaching_thread = buildActiveThread({
    currentSlot: args.currentSlot,
    previousSlot,
    previousSummary,
    userRepliesSummary,
    outcome,
    role,
    focus: checkin_focus,
    pendingPlanProof: args.pendingPlanProof,
    openQuestionPending: args.openQuestionPending === true,
  });

  const send = recommendSend({
    role,
    outcome,
    silenceCadence: args.silenceCadence,
    currentSlot: args.currentSlot,
  });

  return {
    version: SLOT_COACHING_CONTEXT_VERSION,
    authority: SLOT_COACHING_CONTEXT_AUTHORITY,
    current_slot: args.currentSlot,
    previous_slot: previousSlot,
    previous_outbound_summary: previousSummary,
    user_replies_since_previous_outbound: userRepliesSummary || null,
    active_coaching_thread,
    slot_role_recommendation: role,
    checkin_focus: checkin_focus || null,
    should_send_recommendation: send.should_send_recommendation,
    skip_reason_hint: send.skip_reason_hint,
  };
}

/** Strip interpretive thread echo — recent_exact_thread is the only writer transcript. */
export function toWriterFacingSlotCoachingContext(
  ctx: SlotCoachingContextV1
): SlotCoachingContextV1 {
  return {
    ...ctx,
    previous_outbound_summary: null,
    active_coaching_thread: null,
  };
}

export function parseSlotCoachingContextFromMetadata(raw: unknown): SlotCoachingContextV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const current = o.current_slot;
  if (current !== "morning" && current !== "evening_checkin") return null;
  const role = o.slot_role_recommendation;
  const validRoles: SlotCoachingRoleRecommendation[] = [
    "set_today_rep",
    "check_prior_rep",
    "check_user_plan",
    "name_blocker",
    "reset_after_miss",
    "bedtime_setup",
    "wake_up_check",
    "truth_check",
    "skip",
    "relationship_reentry",
  ];
  if (typeof role !== "string" || !validRoles.includes(role as SlotCoachingRoleRecommendation)) {
    return null;
  }
  const sendRec = o.should_send_recommendation;
  if (sendRec !== "send" && sendRec !== "skip" && sendRec !== "writer_decides") return null;
  const prev = o.previous_slot;
  return {
    version: SLOT_COACHING_CONTEXT_VERSION,
    authority: SLOT_COACHING_CONTEXT_AUTHORITY,
    current_slot: current,
    previous_slot: prev === "morning" || prev === "evening_checkin" ? prev : null,
    previous_outbound_summary:
      typeof o.previous_outbound_summary === "string" ? o.previous_outbound_summary : null,
    user_replies_since_previous_outbound:
      typeof o.user_replies_since_previous_outbound === "string"
        ? o.user_replies_since_previous_outbound
        : null,
    active_coaching_thread:
      typeof o.active_coaching_thread === "string" ? o.active_coaching_thread : null,
    slot_role_recommendation: role as SlotCoachingRoleRecommendation,
    checkin_focus: typeof o.checkin_focus === "string" ? o.checkin_focus : null,
    should_send_recommendation: sendRec,
    skip_reason_hint: typeof o.skip_reason_hint === "string" ? o.skip_reason_hint : null,
  };
}

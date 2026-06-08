/**
 * Phase 3.2d — no_send_and_silence_history projector for Relationship Snapshot v2.
 * Read-only writer context for tone/continuity; does not route, mutate state, or authorize sends.
 */

import { isDeliveredCoachQuestionMessage } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { RelationshipMemory7dData } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipPacketStructuredRecentTruth } from "@/lib/sms-relationship-packet-v1";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import type {
  RelationshipSnapshotRouteContext,
  RelationshipSnapshotSurface,
} from "@/lib/sms-relationship-snapshot-v2";
import { isNearExactDuplicateSms, normalizeSmsMemoryRepeatText } from "@/lib/sms-memory-anti-repeat";

export const NO_SEND_SILENCE_HISTORY_AUTHORITY = "structured_recent_truth" as const;

export const MAX_DELIVERY_TRUTH_QUESTIONS = 3 as const;
export const MAX_QUESTION_FINGERPRINT_CHARS = 120 as const;

export type SilenceTierV2 = "none" | "quiet" | "nudge";

export type NoSendSilenceContext = {
  days_since_last_visible_coach_sms?: number | null;
  days_since_last_user_reply?: number | null;
  days_since_last_outcome?: number | null;
  silence_tier?: SilenceTierV2 | null;
  reentry_context?: boolean;
  writer_tone_hint?: string | null;
  weekly_silent_week?: boolean;
  weekly_rough_week?: boolean;
  planned_pause_week?: boolean;
};

export type NoSendDeliveryTruth = {
  recent_questions_not_delivered: string[];
  recent_questions_delivered_but_unanswered: string[];
};

export type NoSendWriterGuidance = {
  do_not_explain_internal_message_failure: true;
  do_not_discuss_internal_send_pipeline: true;
  use_only_for_tone_and_continuity: true;
  may_naturally_reask_if_prior_question_not_delivered: true;
};

export type NoSendAndSilenceHistoryV2Data = {
  last_visible_coach_sms_at?: string | null;
  last_user_reply_at?: string | null;
  last_user_outcome_at?: string | null;
  silence_context: NoSendSilenceContext;
  delivery_truth: NoSendDeliveryTruth;
  writer_guidance: NoSendWriterGuidance;
};

export type NoSendAndSilenceHistoryV2Section = {
  authority: typeof NO_SEND_SILENCE_HISTORY_AUTHORITY;
  data: NoSendAndSilenceHistoryV2Data;
};

export type NoSendSilenceHistoryV2BuildMeta = {
  no_send_silence_history_emitted: true;
  days_since_last_visible_coach_sms?: number | null;
  days_since_last_user_reply?: number | null;
  days_since_last_outcome?: number | null;
  silence_tier?: SilenceTierV2 | null;
  reentry_context?: boolean;
  recent_questions_not_delivered_count: number;
  recent_questions_delivered_unanswered_count: number;
  no_send_silence_history_truncated: boolean;
};

const WRITER_GUIDANCE: NoSendWriterGuidance = {
  do_not_explain_internal_message_failure: true,
  do_not_discuss_internal_send_pipeline: true,
  use_only_for_tone_and_continuity: true,
  may_naturally_reask_if_prior_question_not_delivered: true,
};

function wholeDaysBetween(fromMs: number, toMs: number): number {
  if (fromMs <= 0 || toMs <= fromMs) return 0;
  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function parseAtMs(at: string | null | undefined): number {
  if (!at?.trim()) return 0;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

function normAskKey(text: string): string {
  return normalizeSmsMemoryRepeatText(text)
    .replace(/\?/g, "")
    .replace(/\bthe\b/g, " ")
    .replace(/\ba\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateAsk(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const ak = normAskKey(a);
  const bk = normAskKey(b);
  if (ak && bk && ak === bk) return true;
  return isNearExactDuplicateSms(a, b);
}

function askMatchesAny(text: string, candidates: string[]): boolean {
  return candidates.some((c) => isNearDuplicateAsk(text, c));
}

function truncateQuestionFingerprint(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_QUESTION_FINGERPRINT_CHARS) return t;
  return `${t.slice(0, MAX_QUESTION_FINGERPRINT_CHARS - 1)}…`;
}

function pushUniqueQuestion(out: string[], seen: Set<string>, text: string, minLen = 8): boolean {
  const t = truncateQuestionFingerprint(text);
  if (t.length < minLen) return false;
  const key = normAskKey(t);
  if (!key) return false;
  if (seen.has(key)) return false;
  for (const existing of seen) {
    if (isNearDuplicateAsk(existing, t)) return false;
  }
  seen.add(key);
  out.push(t);
  return true;
}

function extractQuestionClause(coachMessage: string): string | null {
  const msg = coachMessage.trim();
  if (!msg) return null;
  const parts = msg.match(/[^?!.]+[?]/g);
  if (parts?.length) return parts[parts.length - 1]!.trim();
  if (/\?/.test(msg) || /\b(what|when|which|who|how|tell me|give me)\b/i.test(msg)) return msg;
  return null;
}

function isSubstantiveUserMessage(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return false;
  if (/^(stop|start|help|unstop|cancel)$/i.test(t) && t.length <= 12) return false;
  if (/^👍[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*$/u.test(t)) return false;
  const core = t.toLowerCase().replace(/[.!?…]+$/g, "");
  if (["ok", "okay", "k", "got it", "gotit", "sounds good", "👍"].includes(core)) return false;
  return t.length >= 8 || t.split(/\s+/).filter(Boolean).length >= 2;
}

/** Visible coach SMS — sent exact body only (not preview/skipped/system). */
function isVisibleCoachSms(m: RecentExactThread72hMessage): boolean {
  if (m.role !== "coach") return false;
  if (!m.body.trim()) return false;
  if (m.is_exact_body === false) return false;
  return m.delivery_status === "sent";
}

function isUserReplyMessage(m: RecentExactThread72hMessage): boolean {
  return m.role === "user" && m.delivery_status === "sent";
}

function isPreviewCoachQuestion(m: RecentExactThread72hMessage): boolean {
  if (m.role !== "coach") return false;
  if (m.delivery_status !== "preview") return false;
  return Boolean(extractQuestionClause(m.body));
}

function deliveredCoachQuestionKeys(messages: RecentExactThread72hMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (!isDeliveredCoachQuestionMessage(m)) continue;
    const q = extractQuestionClause(m.body);
    if (q) out.add(normAskKey(q));
    out.add(normAskKey(m.body));
  }
  return out;
}

function coachQuestionWasDelivered(question: string, deliveredKeys: Set<string>): boolean {
  if (!deliveredKeys.size) return false;
  const key = normAskKey(question);
  if (deliveredKeys.has(key)) return true;
  for (const dk of deliveredKeys) {
    if (isNearDuplicateAsk(dk, question)) return true;
  }
  return false;
}

function newestTimestamp(messages: RecentExactThread72hMessage[], pred: (m: RecentExactThread72hMessage) => boolean): string | null {
  let bestMs = 0;
  let bestAt: string | null = null;
  for (const m of messages) {
    if (!pred(m)) continue;
    const ms = parseAtMs(m.at);
    if (ms >= bestMs) {
      bestMs = ms;
      bestAt = m.at;
    }
  }
  return bestAt;
}

function newestOutcomeAt(memory7d: RelationshipMemory7dData | null | undefined): string | null {
  if (!memory7d) return null;
  let bestMs = 0;
  let bestAt: string | null = null;
  for (const item of [...memory7d.wins, ...memory7d.misses, ...memory7d.partials]) {
    const ms = parseAtMs(item.at);
    if (ms >= bestMs) {
      bestMs = ms;
      bestAt = item.at;
    }
  }
  return bestAt;
}

function blockedAsksFromOpenLoops(openLoops: OpenLoopsAndDoNotRepeatData | null | undefined): string[] {
  const blocked: string[] = [];
  if (!openLoops) return blocked;
  for (const s of openLoops.satisfied_asks ?? []) {
    if (s.ask_text?.trim()) blocked.push(s.ask_text.trim());
  }
  for (const a of openLoops.do_not_repeat_asks ?? []) {
    if (a?.trim()) blocked.push(a.trim());
  }
  return blocked;
}

function extractDeliveredUnanswered(
  messages: RecentExactThread72hMessage[],
  blockedAsks: string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isDeliveredCoachQuestionMessage(m)) continue;
    const q = extractQuestionClause(m.body);
    if (!q || askMatchesAny(q, blockedAsks)) continue;

    let answered = false;
    for (let j = i + 1; j < messages.length; j++) {
      const follow = messages[j]!;
      if (isUserReplyMessage(follow) && isSubstantiveUserMessage(follow.body)) {
        answered = true;
        break;
      }
    }
    if (answered) continue;
    pushUniqueQuestion(out, seen, q);
    if (out.length >= MAX_DELIVERY_TRUTH_QUESTIONS) break;
  }
  return out;
}

function extractNotDeliveredQuestions(args: {
  messages: RecentExactThread72hMessage[];
  truth: RelationshipPacketStructuredRecentTruth;
  deliveredKeys: Set<string>;
  blockedAsks: string[];
  deliveredUnanswered: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const skipIfDuplicate = (q: string) => {
    if (askMatchesAny(q, args.blockedAsks)) return;
    if (askMatchesAny(q, args.deliveredUnanswered)) return;
    if (coachQuestionWasDelivered(q, args.deliveredKeys)) return;
    pushUniqueQuestion(out, seen, q);
  };

  if (args.truth.open_question_pending && args.truth.latest_open_question?.trim()) {
    skipIfDuplicate(args.truth.latest_open_question.trim());
  }

  for (const m of args.messages) {
    if (m.role === "system_no_send") continue;
    if (!isPreviewCoachQuestion(m)) continue;
    const q = extractQuestionClause(m.body);
    if (q) skipIfDuplicate(q);
    if (out.length >= MAX_DELIVERY_TRUTH_QUESTIONS) return out.slice(0, MAX_DELIVERY_TRUTH_QUESTIONS);
  }

  for (const q of args.truth.last_5_coach_questions ?? []) {
    if (!q?.trim()) continue;
    if (coachQuestionWasDelivered(q, args.deliveredKeys)) continue;
    skipIfDuplicate(q.trim());
    if (out.length >= MAX_DELIVERY_TRUTH_QUESTIONS) break;
  }

  return out.slice(0, MAX_DELIVERY_TRUTH_QUESTIONS);
}

function normalizeSilenceTier(raw: string | null | undefined): SilenceTierV2 | null {
  if (!raw?.trim()) return null;
  const t = raw.trim().toLowerCase();
  if (t === "none" || t === "quiet" || t === "nudge") return t;
  if (t === "high" || t === "long" || t === "moderate") return "nudge";
  if (t === "light") return "quiet";
  return null;
}

function deriveSilenceTierFromDays(args: {
  daysSinceUserReply: number | null;
  daysSinceOutcome: number | null;
  unansweredChecks: number | null;
}): SilenceTierV2 {
  const unanswered = args.unansweredChecks ?? 0;
  const daysReply = args.daysSinceUserReply ?? 0;
  const daysOutcome = args.daysSinceOutcome ?? daysReply;

  if (unanswered >= 3 || daysOutcome >= 10 || daysReply >= 10) return "nudge";
  if (unanswered >= 1 || daysOutcome >= 4 || daysReply >= 4) return "quiet";
  return "none";
}

function resolveWriterToneHint(args: {
  silenceTier: SilenceTierV2 | null;
  reentryContext: boolean;
  hasNotDeliveredQuestions: boolean;
  weeklySilentWeek: boolean;
  weeklyRoughWeek: boolean;
}): string | null {
  if (args.reentryContext || args.hasNotDeliveredQuestions || args.silenceTier === "nudge") {
    return "gentle re-entry; do not imply user ignored an undelivered message";
  }
  if (args.weeklySilentWeek || args.weeklyRoughWeek || args.silenceTier === "quiet") {
    return "quiet relationship; keep it low-pressure";
  }
  return "normal continuity";
}

export function buildNoSendAndSilenceHistoryV2(args: {
  surface: RelationshipSnapshotSurface;
  messages: RecentExactThread72hMessage[];
  structuredRecentTruth: RelationshipPacketStructuredRecentTruth;
  openLoopsAndDoNotRepeat?: OpenLoopsAndDoNotRepeatData | null;
  relationshipMemory7d?: RelationshipMemory7dData | null;
  currentTurn?: Record<string, unknown> | null;
  routeContext?: RelationshipSnapshotRouteContext | null;
  nowMs?: number;
}): { section: NoSendAndSilenceHistoryV2Section; meta: NoSendSilenceHistoryV2BuildMeta } {
  const nowMs = args.nowMs ?? Date.now();
  const messages = args.messages ?? [];
  const truth = args.structuredRecentTruth;
  const memory7d = args.relationshipMemory7d ?? null;
  const openLoops = args.openLoopsAndDoNotRepeat ?? null;
  const currentTurn = args.currentTurn ?? {};
  const isGuided = args.surface === "guided_contract";

  const lastVisibleCoachSmsAt = newestTimestamp(messages, isVisibleCoachSms);
  const lastUserReplyAt = newestTimestamp(messages, isUserReplyMessage);
  const lastUserOutcomeAt = newestOutcomeAt(memory7d);

  const daysSinceVisibleCoach =
    lastVisibleCoachSmsAt != null ? wholeDaysBetween(parseAtMs(lastVisibleCoachSmsAt), nowMs) : null;
  const daysSinceUserReply =
    lastUserReplyAt != null ? wholeDaysBetween(parseAtMs(lastUserReplyAt), nowMs) : null;

  const contextFlags = memory7d?.context_flags ?? {};
  const daysSinceOutcomeFromFlags =
    typeof contextFlags.days_since_last_user_outcome === "number"
      ? contextFlags.days_since_last_user_outcome
      : null;
  const daysSinceOutcome =
    daysSinceOutcomeFromFlags ??
    (lastUserOutcomeAt != null ? wholeDaysBetween(parseAtMs(lastUserOutcomeAt), nowMs) : null);

  const weeklySilentWeek = currentTurn.silent_week === true;
  const weeklyRoughWeek = currentTurn.rough_week === true;
  const plannedPauseWeek = currentTurn.planned_pause_week === true;

  let silenceTier: SilenceTierV2 | null = null;
  if (!isGuided) {
    silenceTier = normalizeSilenceTier(contextFlags.silence_tier ?? null);
  }
  if (silenceTier == null && !isGuided) {
    silenceTier = deriveSilenceTierFromDays({
      daysSinceUserReply,
      daysSinceOutcome,
      unansweredChecks:
        typeof contextFlags.unanswered_checks === "number" ? contextFlags.unanswered_checks : null,
    });
  }
  if (isGuided) {
    silenceTier = deriveSilenceTierFromDays({
      daysSinceUserReply,
      daysSinceOutcome: null,
      unansweredChecks: null,
    });
  }

  const reentryContext =
    !isGuided &&
    (contextFlags.reentry_active === true ||
      silenceTier === "nudge" ||
      (daysSinceOutcome != null && daysSinceOutcome >= 10));

  const blockedAsks = blockedAsksFromOpenLoops(openLoops);
  const deliveredKeys = deliveredCoachQuestionKeys(messages);

  let deliveredUnanswered = extractDeliveredUnanswered(messages, blockedAsks);
  if (deliveredUnanswered.length < MAX_DELIVERY_TRUTH_QUESTIONS && openLoops?.recent_unanswered_coach_questions?.length) {
    const seen = new Set(deliveredUnanswered.map(normAskKey));
    for (const q of openLoops.recent_unanswered_coach_questions) {
      if (askMatchesAny(q, blockedAsks)) continue;
      if (!coachQuestionWasDelivered(q, deliveredKeys)) continue;
      pushUniqueQuestion(deliveredUnanswered, seen, q);
      if (deliveredUnanswered.length >= MAX_DELIVERY_TRUTH_QUESTIONS) break;
    }
  }
  deliveredUnanswered = deliveredUnanswered.slice(0, MAX_DELIVERY_TRUTH_QUESTIONS);

  const notDelivered = extractNotDeliveredQuestions({
    messages,
    truth,
    deliveredKeys,
    blockedAsks,
    deliveredUnanswered,
  });

  const hasNotDeliveredQuestions = notDelivered.length > 0;
  const writerToneHint = resolveWriterToneHint({
    silenceTier,
    reentryContext: reentryContext === true,
    hasNotDeliveredQuestions,
    weeklySilentWeek,
    weeklyRoughWeek,
  });

  const rawDeliveredCount = extractDeliveredUnanswered(messages, blockedAsks).length;
  const rawNotDeliveredCount =
    extractNotDeliveredQuestions({
      messages,
      truth,
      deliveredKeys,
      blockedAsks,
      deliveredUnanswered: [],
    }).length + (openLoops?.recent_unanswered_coach_questions?.length ?? 0);
  const truncated =
    rawDeliveredCount > MAX_DELIVERY_TRUTH_QUESTIONS ||
    rawNotDeliveredCount > MAX_DELIVERY_TRUTH_QUESTIONS;

  const data: NoSendAndSilenceHistoryV2Data = {
    last_visible_coach_sms_at: lastVisibleCoachSmsAt,
    last_user_reply_at: lastUserReplyAt,
    last_user_outcome_at: lastUserOutcomeAt,
    silence_context: {
      days_since_last_visible_coach_sms: daysSinceVisibleCoach,
      days_since_last_user_reply: daysSinceUserReply,
      days_since_last_outcome: daysSinceOutcome,
      silence_tier: silenceTier,
      reentry_context: reentryContext === true,
      writer_tone_hint: writerToneHint,
      weekly_silent_week: weeklySilentWeek || undefined,
      weekly_rough_week: weeklyRoughWeek || undefined,
      planned_pause_week: plannedPauseWeek || undefined,
    },
    delivery_truth: {
      recent_questions_not_delivered: notDelivered,
      recent_questions_delivered_but_unanswered: deliveredUnanswered,
    },
    writer_guidance: WRITER_GUIDANCE,
  };

  return {
    section: {
      authority: NO_SEND_SILENCE_HISTORY_AUTHORITY,
      data,
    },
    meta: {
      no_send_silence_history_emitted: true,
      days_since_last_visible_coach_sms: daysSinceVisibleCoach,
      days_since_last_user_reply: daysSinceUserReply,
      days_since_last_outcome: daysSinceOutcome,
      silence_tier: silenceTier,
      reentry_context: reentryContext === true,
      recent_questions_not_delivered_count: notDelivered.length,
      recent_questions_delivered_unanswered_count: deliveredUnanswered.length,
      no_send_silence_history_truncated: truncated,
    },
  };
}

export function buildNoSendAndSilenceHistoryV2PromptGuidance(): string {
  return `
- no_send_and_silence_history is for relationship tone and continuity only — the server still validates send safety separately.
- Use last_visible_coach_sms_at / last_user_reply_at / last_user_outcome_at for relationship timing, not as send permission.
- silence_context.writer_tone_hint is coaching guidance — do not quote delivery-system mechanics or failure reasons in visible SMS.
- Do not discuss internal delivery systems or message-generation failures in visible SMS.
- Do NOT imply the user ignored a coach question that may not have been delivered.
- If delivery_truth.recent_questions_not_delivered includes a question, you may naturally ask it again — do not treat it as ignored.
- delivery_truth does NOT override satisfied asks or do_not_repeat from open_loops_and_do_not_repeat.
- delivery_truth.recent_questions_delivered_but_unanswered are questions the user likely saw but has not substantively answered yet.`;
}

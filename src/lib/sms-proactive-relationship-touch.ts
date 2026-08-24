/**
 * Quiet-relationship clock: last/first successful proactive Coach Pat SMS.
 * Morning + Evening (sms_send_events) + Weekly (sms_weekly_send_events).
 * Strong delivery evidence only. No drafts, reservations, or check_sent.
 */

import {
  isSendEventStrongDeliveryEvidence,
  timestampFromSendEventRow,
} from "@/lib/sms-recent-exact-thread-72h";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { wholeCalendarDaysBetweenDayKeys } from "@/lib/v2-cadence";
import type { MorningBriefProactiveDecision } from "@/lib/morning-tto-coaching-brief-v1";

export const QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE = 10 as const;
export const QUIET_RELATIONSHIP_MAX_GAP_DAYS = 7 as const;
export const QUIET_RELATIONSHIP_NEVER_REPLIED_MIN_UNANSWERED_OUTBOUND = 1 as const;
export const MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE = "intentional_space" as const;

const CLOCK_ROW_LIMIT = 100 as const;

const SEND_EVENT_CLOCK_SELECT =
  "status, message_sid, outbound_message_sid, metadata, created_at, sent_at, processed_at, updated_at, send_slot, day_key";

const WEEKLY_SEND_EVENT_CLOCK_SELECT =
  "status, message_sid, outbound_message_sid, metadata, created_at, sent_at, processed_at, updated_at, day_key";

export type ProactiveRelationshipTouchSourceTable =
  | "sms_send_events"
  | "sms_weekly_send_events";

export type SuccessfulProactiveRelationshipTouch = {
  atMs: number;
  localDayKey: string;
  sourceTable: ProactiveRelationshipTouchSourceTable;
};

export type SuccessfulProactiveRelationshipTouchClock =
  | {
      ok: true;
      lookupFailed: false;
      last: SuccessfulProactiveRelationshipTouch | null;
      first: SuccessfulProactiveRelationshipTouch | null;
      daysSinceLast: number | null;
      daysSinceFirst: number | null;
    }
  | {
      ok: false;
      lookupFailed: true;
      error: string;
      last: null;
      first: null;
      daysSinceLast: null;
      daysSinceFirst: null;
    };

export type QuietRelationshipEligibility = {
  eligible: boolean;
  reason:
    | "active_user_shield"
    | "days_since_user_response"
    | "never_replied_outbound_history"
    | "not_quiet";
};

function isYyyyMmDd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDailyProactiveSendSlot(slot: unknown): boolean {
  if (slot == null || slot === "") return true;
  if (typeof slot !== "string") return false;
  const t = slot.trim();
  return t === SMS_DAILY_PRODUCTION_SEND_SLOT || t === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
}

function localDayKeyFromSendRow(
  row: Record<string, unknown>,
  timezone: string,
  atMs: number
): string | null {
  const dayKey = typeof row.day_key === "string" ? row.day_key.trim() : "";
  if (isYyyyMmDd(dayKey)) return dayKey;
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  return getDateKeyInTimezone(new Date(atMs), timezone);
}

function touchFromRow(
  row: Record<string, unknown>,
  sourceTable: ProactiveRelationshipTouchSourceTable,
  timezone: string
): SuccessfulProactiveRelationshipTouch | null {
  if (!isSendEventStrongDeliveryEvidence(row)) return null;
  if (sourceTable === "sms_send_events" && !isDailyProactiveSendSlot(row.send_slot)) {
    return null;
  }
  const atMs = timestampFromSendEventRow(row);
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  const localDayKey = localDayKeyFromSendRow(row, timezone, atMs);
  if (!localDayKey) return null;
  return { atMs, localDayKey, sourceTable };
}

function pickLatest(
  a: SuccessfulProactiveRelationshipTouch | null,
  b: SuccessfulProactiveRelationshipTouch | null
): SuccessfulProactiveRelationshipTouch | null {
  if (!a) return b;
  if (!b) return a;
  if (b.atMs > a.atMs) return b;
  if (b.atMs < a.atMs) return a;
  return b.localDayKey > a.localDayKey ? b : a;
}

function pickEarliest(
  a: SuccessfulProactiveRelationshipTouch | null,
  b: SuccessfulProactiveRelationshipTouch | null
): SuccessfulProactiveRelationshipTouch | null {
  if (!a) return b;
  if (!b) return a;
  if (b.atMs < a.atMs) return b;
  if (b.atMs > a.atMs) return a;
  return b.localDayKey < a.localDayKey ? b : a;
}

async function fetchSendEventRows(args: {
  table: ProactiveRelationshipTouchSourceTable;
  clerkUserId: string;
  select: string;
  ascending: boolean;
}): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from(args.table)
    .select(args.select)
    .eq("clerk_user_id", args.clerkUserId)
    .order("created_at", { ascending: args.ascending })
    .limit(CLOCK_ROW_LIMIT);

  if (error) {
    return { ok: false, error: `${args.table}:${error.message}` };
  }
  const rows = Array.isArray(data)
    ? (data as unknown as Record<string, unknown>[])
    : [];
  return { ok: true, rows };
}

function scanTouches(
  rows: Record<string, unknown>[],
  sourceTable: ProactiveRelationshipTouchSourceTable,
  timezone: string
): { last: SuccessfulProactiveRelationshipTouch | null; first: SuccessfulProactiveRelationshipTouch | null } {
  let last: SuccessfulProactiveRelationshipTouch | null = null;
  let first: SuccessfulProactiveRelationshipTouch | null = null;
  for (const row of rows) {
    const touch = touchFromRow(row, sourceTable, timezone);
    if (!touch) continue;
    last = pickLatest(last, touch);
    first = pickEarliest(first, touch);
  }
  return { last, first };
}

/**
 * Authoritative M/E/W successful-send clock in the member's local calendar.
 * Query failure is distinct from "no successful send found."
 */
export async function loadSuccessfulProactiveRelationshipTouchClock(args: {
  clerkUserId: string;
  timezone: string;
  localDate: string;
}): Promise<SuccessfulProactiveRelationshipTouchClock> {
  const clerkUserId = args.clerkUserId.trim();
  const localDate = args.localDate.trim();
  if (!clerkUserId || !isYyyyMmDd(localDate)) {
    return {
      ok: false,
      lookupFailed: true,
      error: "invalid_clock_args",
      last: null,
      first: null,
      daysSinceLast: null,
      daysSinceFirst: null,
    };
  }

  const [dailyNewest, dailyOldest, weeklyNewest, weeklyOldest] = await Promise.all([
    fetchSendEventRows({
      table: "sms_send_events",
      clerkUserId,
      select: SEND_EVENT_CLOCK_SELECT,
      ascending: false,
    }),
    fetchSendEventRows({
      table: "sms_send_events",
      clerkUserId,
      select: SEND_EVENT_CLOCK_SELECT,
      ascending: true,
    }),
    fetchSendEventRows({
      table: "sms_weekly_send_events",
      clerkUserId,
      select: WEEKLY_SEND_EVENT_CLOCK_SELECT,
      ascending: false,
    }),
    fetchSendEventRows({
      table: "sms_weekly_send_events",
      clerkUserId,
      select: WEEKLY_SEND_EVENT_CLOCK_SELECT,
      ascending: true,
    }),
  ]);

  if (!dailyNewest.ok || !dailyOldest.ok || !weeklyNewest.ok || !weeklyOldest.ok) {
    const error = !dailyNewest.ok
      ? dailyNewest.error
      : !dailyOldest.ok
        ? dailyOldest.error
        : !weeklyNewest.ok
          ? weeklyNewest.error
          : weeklyOldest.ok
            ? "clock_lookup_failed"
            : weeklyOldest.error;
    console.warn("[proactive-relationship-touch] clock_lookup_failed", {
      clerk_user_id: clerkUserId,
      error,
    });
    return {
      ok: false,
      lookupFailed: true,
      error,
      last: null,
      first: null,
      daysSinceLast: null,
      daysSinceFirst: null,
    };
  }

  const dailyNew = scanTouches(dailyNewest.rows, "sms_send_events", args.timezone);
  const dailyOld = scanTouches(dailyOldest.rows, "sms_send_events", args.timezone);
  const weeklyNew = scanTouches(weeklyNewest.rows, "sms_weekly_send_events", args.timezone);
  const weeklyOld = scanTouches(weeklyOldest.rows, "sms_weekly_send_events", args.timezone);

  const last = pickLatest(
    pickLatest(dailyNew.last, dailyOld.last),
    pickLatest(weeklyNew.last, weeklyOld.last)
  );
  const first = pickEarliest(
    pickEarliest(dailyNew.first, dailyOld.first),
    pickEarliest(weeklyNew.first, weeklyOld.first)
  );

  return {
    ok: true,
    lookupFailed: false,
    last,
    first,
    daysSinceLast: last ? wholeCalendarDaysBetweenDayKeys(last.localDayKey, localDate) : null,
    daysSinceFirst: first ? wholeCalendarDaysBetweenDayKeys(first.localDayKey, localDate) : null,
  };
}

/**
 * Quiet options become eligible at 10+ local days since last user reply,
 * or never-replied with ≥1 unanswered outbound and 10+ local days since first
 * successful proactive send (same 10-day product number; no second cadence).
 */
export function evaluateQuietRelationshipEligibility(args: {
  daysSinceLastUserResponse: number | null;
  neverReplied: boolean;
  recentUnansweredOutboundCount: number;
  daysSinceFirstSuccessfulProactiveSend: number | null;
  firstSendLookupFailed?: boolean;
}): QuietRelationshipEligibility {
  const daysSince = args.daysSinceLastUserResponse;
  if (daysSince != null && Number.isFinite(daysSince) && daysSince < QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE) {
    return { eligible: false, reason: "active_user_shield" };
  }
  if (daysSince != null && Number.isFinite(daysSince) && daysSince >= QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE) {
    return { eligible: true, reason: "days_since_user_response" };
  }
  if (args.neverReplied !== true) {
    return { eligible: false, reason: "not_quiet" };
  }
  if (args.firstSendLookupFailed === true) {
    return { eligible: false, reason: "not_quiet" };
  }
  const unanswered = Math.max(0, Math.floor(args.recentUnansweredOutboundCount));
  if (unanswered < QUIET_RELATIONSHIP_NEVER_REPLIED_MIN_UNANSWERED_OUTBOUND) {
    return { eligible: false, reason: "not_quiet" };
  }
  const firstDays = args.daysSinceFirstSuccessfulProactiveSend;
  if (firstDays == null || !Number.isFinite(firstDays)) {
    return { eligible: false, reason: "not_quiet" };
  }
  if (firstDays >= QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE) {
    return { eligible: true, reason: "never_replied_outbound_history" };
  }
  return { eligible: false, reason: "not_quiet" };
}

/**
 * Anti-ghost floor. Fail-safe: lookup failure → false (do not force required touch).
 * Known empty last-send while quiet-eligible → true.
 */
export function evaluateMessageRequiredToday(args: {
  quietEligible: boolean;
  daysSinceLastSuccessfulProactiveSend: number | null;
  clockLookupFailed: boolean;
}): boolean {
  if (!args.quietEligible) return false;
  if (args.clockLookupFailed) return false;
  if (args.daysSinceLastSuccessfulProactiveSend == null) return true;
  return args.daysSinceLastSuccessfulProactiveSend >= QUIET_RELATIONSHIP_MAX_GAP_DAYS;
}

export async function resolveQuietRelationshipMechanicalFacts(args: {
  clerkUserId: string;
  timezone: string;
  localDate: string;
  daysSinceLastUserResponse: number | null;
  neverReplied: boolean;
  recentUnansweredOutboundCount: number;
}): Promise<{
  quiet_relationship_eligible: boolean;
  message_required_today: boolean;
  clock_lookup_failed: boolean;
  days_since_last_successful_proactive_send: number | null;
  days_since_first_successful_proactive_send: number | null;
}> {
  const clock = await loadSuccessfulProactiveRelationshipTouchClock({
    clerkUserId: args.clerkUserId,
    timezone: args.timezone,
    localDate: args.localDate,
  });
  const eligibility = evaluateQuietRelationshipEligibility({
    daysSinceLastUserResponse: args.daysSinceLastUserResponse,
    neverReplied: args.neverReplied,
    recentUnansweredOutboundCount: args.recentUnansweredOutboundCount,
    daysSinceFirstSuccessfulProactiveSend: clock.daysSinceFirst,
    firstSendLookupFailed: clock.lookupFailed,
  });
  const message_required_today = evaluateMessageRequiredToday({
    quietEligible: eligibility.eligible,
    daysSinceLastSuccessfulProactiveSend: clock.daysSinceLast,
    clockLookupFailed: clock.lookupFailed,
  });
  return {
    quiet_relationship_eligible: eligibility.eligible,
    message_required_today,
    clock_lookup_failed: clock.lookupFailed,
    days_since_last_successful_proactive_send: clock.daysSinceLast,
    days_since_first_successful_proactive_send: clock.daysSinceFirst,
  };
}

export function clampProactiveDecision(args: {
  decision: MorningBriefProactiveDecision | null | undefined;
  quietRelationshipEligible: boolean;
  messageRequiredToday: boolean;
  /** Clock unavailable → SPACE is illegal. Does not invent required-touch. */
  clockLookupFailed?: boolean;
  forceSend?: boolean;
}): MorningBriefProactiveDecision {
  if (args.forceSend === true) return "send";
  if (args.decision !== "intentional_space") return "send";
  if (args.messageRequiredToday) return "send";
  if (args.clockLookupFailed === true) return "send";
  if (args.quietRelationshipEligible !== true) return "send";
  return "intentional_space";
}

export function isIntentionalSpaceDecision(
  decision: MorningBriefProactiveDecision | null | undefined
): boolean {
  return decision === "intentional_space";
}

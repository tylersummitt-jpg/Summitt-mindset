/**
 * Slice C — durable user-scoped SMS timing / cadence / pause preferences.
 * STOP/opt-out remains sms_audience + Twilio compliance.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import type { V2CadenceLevel } from "@/lib/v2-cadence";
import {
  isV2LearnedSendWindowAllowed,
  type V2SendTimeWindow,
  type V2UserSendTimeProfileRow,
} from "@/lib/v2-send-time-profile";

export const MAX_PAUSE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type V2SmsCommsPauseReasonCategory =
  | "vacation"
  | "travel"
  | "illness"
  | "family_emergency"
  | "grief"
  | "hospital_or_surgery"
  | "competition_or_camp"
  | "work_or_schedule_overload"
  | "pause_request"
  | "weekend_or_short_break"
  | "other";

export type V2SmsCommsCadenceOverride = "daily" | "every_other_day" | "every_3_days";

export type V2SmsCommsWeekendPolicy = "all" | "weekdays_only";

export type V2UserSmsCommsPreferencesRow = {
  clerk_user_id: string;
  pause_until: string | null;
  pause_reason_category: V2SmsCommsPauseReasonCategory | null;
  cadence_override: V2SmsCommsCadenceOverride | null;
  weekend_send_policy: V2SmsCommsWeekendPolicy | null;
  preferred_send_window: V2SendTimeWindow | null;
  preferred_local_hour: number | null;
  source_message_sid: string | null;
  resume_prompt_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommsPreferenceAction =
  | "none"
  | "pause_until"
  | "clear_pause"
  | "cadence_override"
  | "clear_cadence"
  | "weekend_policy"
  | "preferred_time"
  | "clear_all_active"
  | "clarify";

export type CommsPreferenceConfidence = "high" | "medium" | "low";

export type InboundSmsCommsPreferenceParseResult = {
  action: CommsPreferenceAction;
  confidence: CommsPreferenceConfidence;
  needsCadenceClarification: boolean;
  pauseUntilIso: string | null;
  pauseReasonCategory: V2SmsCommsPauseReasonCategory | null;
  cadenceOverride: V2SmsCommsCadenceOverride | null;
  clearCadenceOverride: boolean;
  weekendSendPolicy: V2SmsCommsWeekendPolicy | null;
  preferredSendWindow: V2SendTimeWindow | null;
  preferredLocalHour: number | null;
  clearPreferredTime: boolean;
};

export type InboundSmsCommsPreferenceTurnSnapshot = {
  parse: InboundSmsCommsPreferenceParseResult;
  preferenceWriteOk: boolean;
  rowAfter: V2UserSmsCommsPreferencesRow | null;
};

const EXACT_STOP_RE = /^\s*(stop|unsubscribe|cancel|end)\s*$/i;
const EXACT_HELP_START_RE = /^\s*(help|info|start|unstop)\s*$/i;

const SUBSCRIPTION_INTEGRITY_RE =
  /\b(cancel\s+my\s+subscription|cancel\s+my\s+membership|stop\s+charging\s+me|billing\s+issue|need\s+a\s+refund|refund\s+my)\b/i;

const DAY_NAMES =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun";

/** Vacation/travel/illness/tournament/weekend context without an explicit pause ask. */
const INTERRUPTION_CONTEXT_RE =
  /\b(vacation|traveling|travelling|travel|sick|ill(?:ness)?|flu|fever|tournament|weekend)\b/i;

/** User wants coaching/accountability to continue despite interruption context. */
const CONTINUE_ACCOUNTABILITY_RE =
  /\b(still\s+want\s+(?:the\s+)?accountability|still\s+want\s+to\s+keep\s+trying|still\s+want\s+to\s+hit\s+my\s+goal|keep\s+checking\s+on\s+me|keep\s+texting\s+me|still\s+text\s+me|still\s+check\s+in|give\s+me\s+a\s+smaller\s+version|keep\s+holding\s+me\s+accountable|but\s+still)\b/i;

const EXPLICIT_PAUSE_TEXTS_UNTIL_RE =
  /\bpause\s+(?:the\s+)?(?:texts?|texting|check-?ins)\s+until\b/i;

const PAUSE_DEADLINE_CLUE_RE = new RegExp(
  `\\b(next\\s+week|few\\s+days|tomorrow|this\\s+week|this\\s+weekend|for\\s+a\\s+week|next\\s+monday|stop\\s+for|until\\s+(?:${DAY_NAMES}))\\b`,
  "i"
);

function hasContinueAccountabilityLanguage(t: string): boolean {
  return CONTINUE_ACCOUNTABILITY_RE.test(t);
}

/** Illness pause only when a window or explicit pause/no-text phrase is present. */
function hasExplicitIllnessPauseWindow(t: string): boolean {
  if (!/\b(?:i'?m\s+)?sick\b|\bill(?:ness)?\b|\bflu\b|\bfever\b/i.test(t)) return false;
  return (
    /\bthis\s+week\b/i.test(t) ||
    new RegExp(`\\buntil\\s+(${DAY_NAMES})\\b`, "i").test(t) ||
    /\bfew\s+days\b/i.test(t) ||
    /\bstop\s+for\b/i.test(t) ||
    /\bpause\s+(?:me\s+|(?:the\s+)?(?:texts?|texting|check-?ins)\s+)?until\b/i.test(t) ||
    /\bdon'?t\s+text\b/i.test(t) ||
    /\bfor\s+a\s+week\b/i.test(t) ||
    /\bnext\s+week\b/i.test(t)
  );
}

function hasExplicitPauseRequest(t: string): boolean {
  return (
    EXPLICIT_PAUSE_TEXTS_UNTIL_RE.test(t) ||
    /\bpause\s+me\s+until\b/i.test(t) ||
    /\bstop\s+for\s+a\s+few\s+days\b/i.test(t) ||
    /\b(traveling|travelling)\s+until\b/i.test(t) ||
    /\bvacation\s+until\b/i.test(t) ||
    /\bdon'?t\s+text\s+me\s+this\s+weekend\b/i.test(t) ||
    /\bthis\s+week\s+is\s+impossible\b/i.test(t) ||
    hasExplicitIllnessPauseWindow(t)
  );
}

function clarifyPauseResult(): InboundSmsCommsPreferenceParseResult {
  return {
    action: "clarify",
    confidence: "medium",
    needsCadenceClarification: false,
    pauseUntilIso: null,
    pauseReasonCategory: null,
    cadenceOverride: null,
    clearCadenceOverride: false,
    weekendSendPolicy: null,
    preferredSendWindow: null,
    preferredLocalHour: null,
    clearPreferredTime: false,
  };
}

function pauseUntilParseResult(args: {
  body: string;
  timezone: string;
  now: Date;
  reason: V2SmsCommsPauseReasonCategory;
}): InboundSmsCommsPreferenceParseResult {
  const dl = parseCommsPreferenceDeadline({
    body: args.body,
    timezone: args.timezone,
    now: args.now,
  });
  if (dl.pauseUntil && !dl.ambiguous) {
    return {
      action: "pause_until",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: dl.pauseUntil.toISOString(),
      pauseReasonCategory:
        args.reason === "illness" || dl.reason === "illness"
          ? "illness"
          : (dl.reason ?? args.reason),
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }
  return clarifyPauseResult();
}

function mapRow(data: Record<string, unknown>): V2UserSmsCommsPreferencesRow {
  const pw = data.preferred_send_window;
  const window: V2SendTimeWindow | null =
    pw === "morning" || pw === "midday" || pw === "afternoon" || pw === "evening" ? pw : null;

  const co = data.cadence_override;
  const cadence: V2SmsCommsCadenceOverride | null =
    co === "daily" || co === "every_other_day" || co === "every_3_days" ? co : null;

  const wp = data.weekend_send_policy;
  const weekend: V2SmsCommsWeekendPolicy | null =
    wp === "all" || wp === "weekdays_only" ? wp : null;

  const pr = data.pause_reason_category;
  const pauseReason: V2SmsCommsPauseReasonCategory | null =
    pr === "vacation" ||
    pr === "travel" ||
    pr === "illness" ||
    pr === "family_emergency" ||
    pr === "grief" ||
    pr === "hospital_or_surgery" ||
    pr === "competition_or_camp" ||
    pr === "work_or_schedule_overload" ||
    pr === "pause_request" ||
    pr === "weekend_or_short_break" ||
    pr === "other"
      ? pr
      : null;

  const hourRaw = data.preferred_local_hour;
  const hour =
    typeof hourRaw === "number" && Number.isFinite(hourRaw)
      ? Math.min(23, Math.max(0, Math.floor(hourRaw)))
      : null;

  return {
    clerk_user_id: String(data.clerk_user_id),
    pause_until: typeof data.pause_until === "string" ? data.pause_until : null,
    pause_reason_category: pauseReason,
    cadence_override: cadence,
    weekend_send_policy: weekend,
    preferred_send_window: window,
    preferred_local_hour: hour,
    source_message_sid: typeof data.source_message_sid === "string" ? data.source_message_sid : null,
    resume_prompt_sent_at:
      typeof data.resume_prompt_sent_at === "string" ? data.resume_prompt_sent_at : null,
    created_at: typeof data.created_at === "string" ? data.created_at : new Date().toISOString(),
    updated_at: typeof data.updated_at === "string" ? data.updated_at : new Date().toISOString(),
  };
}

export function isPauseActive(row: V2UserSmsCommsPreferencesRow | null, now: Date = new Date()): boolean {
  if (!row?.pause_until) return false;
  const t = new Date(row.pause_until).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

export async function fetchV2UserSmsCommsPreferences(
  clerkUserId: string
): Promise<V2UserSmsCommsPreferencesRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_user_sms_comms_preferences")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.warn("[v2-sms-comms-prefs] fetch failed (fail open)", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function upsertV2UserSmsCommsPreferences(args: {
  clerkUserId: string;
  patch: Partial<
    Pick<
      V2UserSmsCommsPreferencesRow,
      | "pause_until"
      | "pause_reason_category"
      | "cadence_override"
      | "weekend_send_policy"
      | "preferred_send_window"
      | "preferred_local_hour"
      | "source_message_sid"
    >
  >;
  clearPause?: boolean;
  clearCadenceOverride?: boolean;
}): Promise<{ ok: boolean; row: V2UserSmsCommsPreferencesRow | null; error?: string }> {
  const existing = await fetchV2UserSmsCommsPreferences(args.clerkUserId);
  const base = existing ?? {
    clerk_user_id: args.clerkUserId,
    pause_until: null,
    pause_reason_category: null,
    cadence_override: null,
    weekend_send_policy: null,
    preferred_send_window: null,
    preferred_local_hour: null,
    source_message_sid: null,
    resume_prompt_sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const merged: V2UserSmsCommsPreferencesRow = {
    ...base,
    pause_until: args.clearPause ? null : (args.patch.pause_until ?? base.pause_until),
    pause_reason_category: args.clearPause
      ? null
      : args.patch.pause_reason_category !== undefined
        ? args.patch.pause_reason_category
        : base.pause_reason_category,
    cadence_override: args.clearCadenceOverride
      ? null
      : args.patch.cadence_override !== undefined
        ? args.patch.cadence_override
        : base.cadence_override,
    weekend_send_policy:
      args.patch.weekend_send_policy !== undefined
        ? args.patch.weekend_send_policy
        : base.weekend_send_policy,
    preferred_send_window:
      args.patch.preferred_send_window !== undefined
        ? args.patch.preferred_send_window
        : base.preferred_send_window,
    preferred_local_hour:
      args.patch.preferred_local_hour !== undefined
        ? args.patch.preferred_local_hour
        : base.preferred_local_hour,
    source_message_sid:
      args.patch.source_message_sid !== undefined
        ? args.patch.source_message_sid
        : base.source_message_sid,
  };

  const { data, error } = await supabaseServer.from("v2_user_sms_comms_preferences").upsert(
    {
      clerk_user_id: args.clerkUserId,
      pause_until: merged.pause_until,
      pause_reason_category: merged.pause_reason_category,
      cadence_override: merged.cadence_override,
      weekend_send_policy: merged.weekend_send_policy,
      preferred_send_window: merged.preferred_send_window,
      preferred_local_hour: merged.preferred_local_hour,
      source_message_sid: merged.source_message_sid,
      resume_prompt_sent_at: merged.resume_prompt_sent_at,
    },
    { onConflict: "clerk_user_id" }
  );

  if (error) {
    return { ok: false, row: null, error: error.message };
  }
  return { ok: true, row: mapRow((data ?? merged) as Record<string, unknown>) };
}

/** Clears pause + cadence override on SMS resume (START). Keeps timing/weekend prefs. */
export async function clearCommsPreferencesOnSmsResume(clerkUserId: string): Promise<void> {
  const { error } = await supabaseServer.from("v2_user_sms_comms_preferences").upsert(
    {
      clerk_user_id: clerkUserId,
      pause_until: null,
      pause_reason_category: null,
      cadence_override: null,
    },
    { onConflict: "clerk_user_id" }
  );
  if (error) {
    console.warn("[v2-sms-comms-prefs] clear on START failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
  }
}

function localDateParts(at: Date, timeZone: string): { y: number; m: number; d: number; dow: number } {
  const tz = resolveUserTimezone(timeZone);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(at);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const d = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y, m, d, dow: dowMap[wd] ?? 0 };
}

/** Resume at `hour` (default 7) local on calendar y-m-d in `timeZone`. */
function pauseUntilAtLocal(args: {
  y: number;
  m: number;
  d: number;
  hour?: number;
  timeZone: string;
}): Date {
  const tz = resolveUserTimezone(args.timeZone);
  const targetHour = args.hour ?? 7;
  const monthIndex = args.m - 1;
  for (const utcHour of [12, 13, 14, 15, 16, 17, 18, 11, 10, 9, 8, 7, 6, 5, 4]) {
    const candidate = new Date(Date.UTC(args.y, monthIndex, args.d, utcHour, 0, 0));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const cy = Number(parts.find((p) => p.type === "year")?.value);
    const cm = Number(parts.find((p) => p.type === "month")?.value);
    const cd = Number(parts.find((p) => p.type === "day")?.value);
    const ch = Number(parts.find((p) => p.type === "hour")?.value);
    if (cy === args.y && cm === args.m && cd === args.d && ch === targetHour) {
      return candidate;
    }
  }
  return new Date(Date.UTC(args.y, monthIndex, args.d, 12, 0, 0));
}

function clampPauseUntil(candidate: Date, now: Date): Date {
  const max = now.getTime() + MAX_PAUSE_DURATION_MS;
  const t = candidate.getTime();
  if (t > max) return new Date(max);
  if (t < now.getTime()) return new Date(now.getTime() + 3600000);
  return candidate;
}

function nextWeekdayLocal7am(args: {
  targetDow: number;
  timeZone: string;
  now: Date;
  allowTodayIfBefore7am: boolean;
}): Date {
  const { dow, y, m, d } = localDateParts(args.now, args.timeZone);
  let daysAhead = (args.targetDow - dow + 7) % 7;
  if (daysAhead === 0 && !args.allowTodayIfBefore7am) {
    daysAhead = 7;
  }
  if (daysAhead === 0 && args.allowTodayIfBefore7am) {
    const hourFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: resolveUserTimezone(args.timeZone),
      hour: "numeric",
      hour12: false,
    });
    const hour = Number(hourFmt.formatToParts(args.now).find((p) => p.type === "hour")?.value ?? "12");
    if (hour >= 7) daysAhead = 7;
  }
  const target = new Date(args.now.getTime() + daysAhead * 86400000);
  const tp = localDateParts(target, args.timeZone);
  return pauseUntilAtLocal({ y: tp.y, m: tp.m, d: tp.d, hour: 7, timeZone: args.timeZone });
}

/** Conservative deadline parsing for pause_until (07:00 local on resume day). */
export function parseCommsPreferenceDeadline(args: {
  body: string;
  timezone: string;
  now: Date;
}): { pauseUntil: Date | null; reason: V2SmsCommsPauseReasonCategory | null; ambiguous: boolean } {
  const t = args.body.trim().replace(/\s+/g, " ");
  const lower = t.toLowerCase();
  const tz = resolveUserTimezone(args.timezone);
  const now = args.now;

  if (/\bthis\s+weekend\b/i.test(t) || /\bdon'?t\s+text\s+me\s+this\s+weekend\b/i.test(t)) {
    const until = nextWeekdayLocal7am({ targetDow: 1, timeZone: tz, now, allowTodayIfBefore7am: false });
    return { pauseUntil: clampPauseUntil(until, now), reason: "weekend_or_short_break", ambiguous: false };
  }

  const untilDay = t.match(
    new RegExp(
      `\\b(?:until|pause\\s+(?:me\\s+)?until|vacation\\s+until|traveling\\s+until|travelling\\s+until)\\s+(${DAY_NAMES})\\b`,
      "i"
    )
  );
  if (untilDay?.[1]) {
    const target = dayNameToDow(untilDay[1]);
    const allowToday = target === localDateParts(now, tz).dow;
    const until = nextWeekdayLocal7am({
      targetDow: target,
      timeZone: tz,
      now,
      allowTodayIfBefore7am: allowToday,
    });
    const reason = /\bvacation\b/i.test(t)
      ? "vacation"
      : /\btravel/i.test(t)
        ? "travel"
        : "pause_request";
    return { pauseUntil: clampPauseUntil(until, now), reason, ambiguous: false };
  }

  if (/\btomorrow\b/i.test(t)) {
    const tomorrow = new Date(now.getTime() + 86400000);
    const tp = localDateParts(tomorrow, tz);
    const until = pauseUntilAtLocal({ y: tp.y, m: tp.m, d: tp.d, hour: 7, timeZone: tz });
    return { pauseUntil: clampPauseUntil(until, now), reason: "pause_request", ambiguous: false };
  }

  if (/\bnext\s+week\b/i.test(t) || /\buntil\s+next\s+week\b/i.test(t)) {
    const until = pauseUntilAtLocal({
      y: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).y,
      m: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).m,
      d: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).d,
      hour: 7,
      timeZone: tz,
    });
    const reason = /\btravel/i.test(t) ? "travel" : "pause_request";
    return { pauseUntil: clampPauseUntil(until, now), reason, ambiguous: false };
  }

  if (/\bfew\s+days\b/i.test(t) || /\bstop\s+for\s+a\s+few\s+days\b/i.test(t)) {
    const until = pauseUntilAtLocal({
      y: localDateParts(new Date(now.getTime() + 3 * 86400000), tz).y,
      m: localDateParts(new Date(now.getTime() + 3 * 86400000), tz).m,
      d: localDateParts(new Date(now.getTime() + 3 * 86400000), tz).d,
      hour: 7,
      timeZone: tz,
    });
    return { pauseUntil: clampPauseUntil(until, now), reason: "pause_request", ambiguous: false };
  }

  if (/\bthis\s+week\b/i.test(t)) {
    const endOfWeek = endOfIsoWeekLocal(now, tz);
    const until = pauseUntilAtLocal({
      y: endOfWeek.y,
      m: endOfWeek.m,
      d: endOfWeek.d,
      hour: 7,
      timeZone: tz,
    });
    const reason = /\bsick|ill|flu|fever\b/i.test(t) ? "illness" : "pause_request";
    return { pauseUntil: clampPauseUntil(until, now), reason, ambiguous: false };
  }

  if (/\bfor\s+a\s+week\b/i.test(t)) {
    const until = pauseUntilAtLocal({
      y: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).y,
      m: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).m,
      d: localDateParts(new Date(now.getTime() + 7 * 86400000), tz).d,
      hour: 7,
      timeZone: tz,
    });
    return { pauseUntil: clampPauseUntil(until, now), reason: "pause_request", ambiguous: false };
  }

  if (/\bnext\s+monday\b/i.test(t)) {
    const until = nextWeekdayLocal7am({ targetDow: 1, timeZone: tz, now, allowTodayIfBefore7am: false });
    return { pauseUntil: clampPauseUntil(until, now), reason: "pause_request", ambiguous: false };
  }

  return { pauseUntil: null, reason: null, ambiguous: true };
}

function dayNameToDow(name: string): number {
  const n = name.toLowerCase().slice(0, 3);
  const map: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };
  return map[n] ?? 1;
}

function endOfIsoWeekLocal(now: Date, timeZone: string): { y: number; m: number; d: number } {
  const { dow, y, m, d } = localDateParts(now, timeZone);
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  const end = new Date(now.getTime() + daysToSunday * 86400000);
  const ep = localDateParts(end, timeZone);
  const mondayAfter = new Date(end.getTime() + 86400000);
  const mp = localDateParts(mondayAfter, timeZone);
  return mp;
}

function noneResult(): InboundSmsCommsPreferenceParseResult {
  return {
    action: "none",
    confidence: "low",
    needsCadenceClarification: false,
    pauseUntilIso: null,
    pauseReasonCategory: null,
    cadenceOverride: null,
    clearCadenceOverride: false,
    weekendSendPolicy: null,
    preferredSendWindow: null,
    preferredLocalHour: null,
    clearPreferredTime: false,
  };
}

export function parseInboundSmsCommsPreference(args: {
  body: string;
  timezone: string;
  now?: Date;
}): InboundSmsCommsPreferenceParseResult {
  const raw = args.body.trim();
  const t = raw.replace(/\s+/g, " ");
  const lower = t.toLowerCase();
  const now = args.now ?? new Date();

  if (!t) return noneResult();
  if (EXACT_STOP_RE.test(t) || EXACT_HELP_START_RE.test(t)) return noneResult();
  if (SUBSCRIPTION_INTEGRITY_RE.test(t)) return noneResult();

  if (/\b(start\s+texting\s+me\s+again|resume\s+texts?)\b/i.test(t)) {
    return {
      action: "clear_pause",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (/\b(keep\s+texting\s+me\s+)?daily\b/i.test(t) && /\b(keep|actually|text)\b/i.test(t)) {
    return {
      action: "clear_cadence",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: true,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (
    /\b(text\s+me\s+)?every\s+other\s+day\b/i.test(t) ||
    /\bevery\s+other\s+day\b/i.test(t)
  ) {
    return {
      action: "cadence_override",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: "every_other_day",
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (/\b(text\s+me\s+)?every\s+(3|three)\s+days\b/i.test(t)) {
    return {
      action: "cadence_override",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: "every_3_days",
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (/\b(don'?t\s+text\s+me\s+on\s+weekends?|only\s+weekdays?)\b/i.test(t)) {
    return {
      action: "weekend_policy",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: "weekdays_only",
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  const at7 = t.match(/\b(?:text\s+me\s+)?at\s+(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)\b/i);
  if (at7) {
    let hour = Number(at7[1]);
    const ampm = at7[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const window: V2SendTimeWindow = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    return {
      action: "preferred_time",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: window,
      preferredLocalHour: hour,
      clearPreferredTime: false,
    };
  }

  if (/\btext\s+me\s+in\s+the\s+morning\b/i.test(t) || /\btext\s+me\s+each\s+morning\b/i.test(t)) {
    return {
      action: "preferred_time",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: "morning",
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (/\btext\s+me\s+tonight\b/i.test(t) || /\btext\s+me\s+in\s+the\s+evening\b/i.test(t)) {
    return {
      action: "preferred_time",
      confidence: "high",
      needsCadenceClarification: false,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: "evening",
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (/\b(text\s+me\s+less|fewer\s+texts?)\b/i.test(t) && !/\bevery\s+other\b/i.test(t)) {
    return {
      action: "clarify",
      confidence: "medium",
      needsCadenceClarification: true,
      pauseUntilIso: null,
      pauseReasonCategory: null,
      cadenceOverride: null,
      clearCadenceOverride: false,
      weekendSendPolicy: null,
      preferredSendWindow: null,
      preferredLocalHour: null,
      clearPreferredTime: false,
    };
  }

  if (
    INTERRUPTION_CONTEXT_RE.test(t) &&
    hasContinueAccountabilityLanguage(t) &&
    !hasExplicitPauseRequest(t)
  ) {
    return noneResult();
  }

  if (EXPLICIT_PAUSE_TEXTS_UNTIL_RE.test(t)) {
    if (/\buntil\s+i'?m\s+back\b/i.test(t) && !PAUSE_DEADLINE_CLUE_RE.test(t)) {
      return clarifyPauseResult();
    }
    const reason: V2SmsCommsPauseReasonCategory = /\btravel/i.test(t) ? "travel" : "pause_request";
    return pauseUntilParseResult({ body: t, timezone: args.timezone, now, reason });
  }

  if (hasExplicitIllnessPauseWindow(t) && !hasContinueAccountabilityLanguage(t)) {
    return pauseUntilParseResult({ body: t, timezone: args.timezone, now, reason: "illness" });
  }

  if (
    /\b(?:i'?m\s+)?sick\b/i.test(t) &&
    !hasExplicitIllnessPauseWindow(t) &&
    !hasContinueAccountabilityLanguage(t)
  ) {
    return clarifyPauseResult();
  }

  if (
    /\bi'?m\s+on\s+vacation\b/i.test(t) &&
    !/\buntil\b/i.test(t) &&
    !hasContinueAccountabilityLanguage(t)
  ) {
    return clarifyPauseResult();
  }

  const pausePhrase =
    /\bpause\s+me\s+until\b/i.test(t) ||
    /\bstop\s+for\s+a\s+few\s+days\b/i.test(t) ||
    /\b(traveling|travelling)\s+until\b/i.test(t) ||
    /\bvacation\s+until\b/i.test(t) ||
    /\bdon'?t\s+text\s+me\s+this\s+weekend\b/i.test(t) ||
    /\bthis\s+week\s+is\s+impossible\b/i.test(t);

  if (pausePhrase) {
    const reason: V2SmsCommsPauseReasonCategory = /\bvacation\b/i.test(t)
      ? "vacation"
      : /\btravel/i.test(t)
        ? "travel"
        : "pause_request";
    return pauseUntilParseResult({ body: t, timezone: args.timezone, now, reason });
  }

  if (/\bresume\s+monday\b/i.test(t)) {
    const dl = parseCommsPreferenceDeadline({
      body: "pause me until Monday",
      timezone: args.timezone,
      now,
    });
    if (dl.pauseUntil) {
      return {
        action: "pause_until",
        confidence: "high",
        needsCadenceClarification: false,
        pauseUntilIso: dl.pauseUntil.toISOString(),
        pauseReasonCategory: "pause_request",
        cadenceOverride: null,
        clearCadenceOverride: false,
        weekendSendPolicy: null,
        preferredSendWindow: null,
        preferredLocalHour: null,
        clearPreferredTime: false,
      };
    }
  }

  return noneResult();
}

export function shouldSkipDailyForCommsPrefs(
  row: V2UserSmsCommsPreferencesRow | null,
  localNow: Date,
  now: Date = new Date()
): { skip: boolean; reason: "user_pause" | "weekend_policy" | null } {
  if (isPauseActive(row, now)) {
    return { skip: true, reason: "user_pause" };
  }
  if (row?.weekend_send_policy === "weekdays_only") {
    const dow = localNow.getDay();
    if (dow === 0 || dow === 6) {
      return { skip: true, reason: "weekend_policy" };
    }
  }
  return { skip: false, reason: null };
}

export function shouldSkipWeeklyForCommsPrefs(
  row: V2UserSmsCommsPreferencesRow | null,
  now: Date = new Date()
): boolean {
  return isPauseActive(row, now);
}

export type DailySendWindowPolicy = {
  useExplicitHour: boolean;
  explicitHour: number | null;
  useExplicitWindow: boolean;
  explicitWindow: V2SendTimeWindow | null;
  useLearnedProfile: boolean;
  learnedProfile: V2UserSendTimeProfileRow | null;
  clerkPreferenceKey: string;
};

export function resolveDailySendWindowPolicy(args: {
  prefs: V2UserSmsCommsPreferencesRow | null;
  learnedProfile: V2UserSendTimeProfileRow | null;
  clerkSmsTimePreference: string;
}): DailySendWindowPolicy {
  if (args.prefs?.preferred_local_hour != null) {
    return {
      useExplicitHour: true,
      explicitHour: args.prefs.preferred_local_hour,
      useExplicitWindow: false,
      explicitWindow: null,
      useLearnedProfile: false,
      learnedProfile: null,
      clerkPreferenceKey: args.clerkSmsTimePreference,
    };
  }
  if (args.prefs?.preferred_send_window) {
    return {
      useExplicitHour: false,
      explicitHour: null,
      useExplicitWindow: true,
      explicitWindow: args.prefs.preferred_send_window,
      useLearnedProfile: false,
      learnedProfile: null,
      clerkPreferenceKey: args.clerkSmsTimePreference,
    };
  }
  return {
    useExplicitHour: false,
    explicitHour: null,
    useExplicitWindow: false,
    explicitWindow: null,
    useLearnedProfile: true,
    learnedProfile: args.learnedProfile,
    clerkPreferenceKey: args.clerkSmsTimePreference,
  };
}

export function shouldApplyUserCadenceOverride(
  row: V2UserSmsCommsPreferencesRow | null,
  now: Date = new Date()
): V2CadenceLevel | null {
  if (isPauseActive(row, now)) return null;
  return row?.cadence_override ?? null;
}

export async function applyInboundSmsCommsPreferencesFromMessage(args: {
  clerkUserId: string;
  messageSid: string;
  body: string;
  timezone: string;
  now?: Date;
}): Promise<InboundSmsCommsPreferenceTurnSnapshot> {
  const now = args.now ?? new Date();
  const existing = await fetchV2UserSmsCommsPreferences(args.clerkUserId);
  const parse = parseInboundSmsCommsPreference({
    body: args.body,
    timezone: args.timezone,
    now,
  });

  if (parse.confidence !== "high" || parse.action === "none" || parse.action === "clarify") {
    return { parse, preferenceWriteOk: false, rowAfter: existing };
  }

  let writeOk = false;
  let rowAfter: V2UserSmsCommsPreferencesRow | null = existing;

  try {
    switch (parse.action) {
      case "pause_until": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: {
            pause_until: parse.pauseUntilIso,
            pause_reason_category: parse.pauseReasonCategory,
            source_message_sid: args.messageSid,
          },
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      case "clear_pause": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: { source_message_sid: args.messageSid },
          clearPause: true,
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      case "cadence_override": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: {
            cadence_override: parse.cadenceOverride,
            source_message_sid: args.messageSid,
          },
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      case "clear_cadence": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: { source_message_sid: args.messageSid },
          clearCadenceOverride: true,
          clearPause: /\b(keep|daily|texting)\b/i.test(args.body) && /\bdaily\b/i.test(args.body),
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      case "weekend_policy": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: {
            weekend_send_policy: parse.weekendSendPolicy,
            source_message_sid: args.messageSid,
          },
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      case "preferred_time": {
        const r = await upsertV2UserSmsCommsPreferences({
          clerkUserId: args.clerkUserId,
          patch: {
            preferred_send_window: parse.preferredSendWindow,
            preferred_local_hour: parse.preferredLocalHour,
            source_message_sid: args.messageSid,
          },
        });
        writeOk = r.ok;
        rowAfter = r.row;
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.warn("[v2-sms-comms-prefs] apply inbound failed", {
      clerk_user_id: args.clerkUserId,
      message: e instanceof Error ? e.message : String(e),
    });
    writeOk = false;
  }

  return { parse, preferenceWriteOk: writeOk, rowAfter };
}

/** Facts block for V3 inbound lane. */
export function buildInboundCommsPreferenceV3Facts(args: {
  snapshot: InboundSmsCommsPreferenceTurnSnapshot | null;
  row: V2UserSmsCommsPreferencesRow | null;
  now?: Date;
}): {
  comms_preference_action: string;
  preference_write_ok: boolean;
  pause_active: boolean;
  pause_until_iso: string | null;
  pause_reason_category: string | null;
  cadence_override: string | null;
  weekend_send_policy: string | null;
  preferred_send_window: string | null;
  preferred_local_hour: number | null;
  needs_cadence_clarification: boolean;
  required_meaning_lines: string[];
} {
  const now = args.now ?? new Date();
  const snap = args.snapshot;
  const row = args.snapshot?.rowAfter ?? args.row;
  const pauseActive = isPauseActive(row, now);

  const lines: string[] = [
    "COMMS_PREFERENCES (server-owned SMS timing/cadence/pause):",
    `comms_preference_action: ${snap?.parse.action ?? "none"}`,
    `preference_write_ok: ${snap?.preferenceWriteOk === true}`,
    `pause_active: ${pauseActive}`,
    `pause_until_iso: ${row?.pause_until ?? "null"}`,
    `pause_reason_category: ${row?.pause_reason_category ?? "null"}`,
    `cadence_override: ${row?.cadence_override ?? "null"}`,
    `weekend_send_policy: ${row?.weekend_send_policy ?? "null"}`,
    `preferred_send_window: ${row?.preferred_send_window ?? "null"}`,
    `preferred_local_hour: ${row?.preferred_local_hour ?? "null"}`,
    `needs_cadence_clarification: ${snap?.parse.needsCadenceClarification === true}`,
    "Do not claim proactive texts are paused unless preference_write_ok is true AND pause_active is true.",
    "Do not claim cadence or send timing changed unless preference_write_ok is true and the corresponding field is set or cleared on this turn.",
    "If needs_cadence_clarification is true, ask one natural question (fewer texts vs full pause until a date) — no menu, no Reply YES.",
    "STOP/HELP/START are compliance outside this lane.",
  ];

  return {
    comms_preference_action: snap?.parse.action ?? "none",
    preference_write_ok: snap?.preferenceWriteOk === true,
    pause_active: pauseActive,
    pause_until_iso: row?.pause_until ?? null,
    pause_reason_category: row?.pause_reason_category ?? null,
    cadence_override: row?.cadence_override ?? null,
    weekend_send_policy: row?.weekend_send_policy ?? null,
    preferred_send_window: row?.preferred_send_window ?? null,
    preferred_local_hour: row?.preferred_local_hour ?? null,
    needs_cadence_clarification: snap?.parse.needsCadenceClarification === true,
    required_meaning_lines: lines,
  };
}

export function isLocalSendWindowAllowedForPolicy(
  localNow: Date,
  policy: DailySendWindowPolicy,
  learnedGate: (profile: V2UserSendTimeProfileRow) => boolean
): boolean {
  if (policy.useExplicitHour && policy.explicitHour != null) {
    return localNow.getHours() === policy.explicitHour;
  }
  if (policy.useExplicitWindow && policy.explicitWindow) {
    return isV2LearnedSendWindowAllowed(localNow, policy.explicitWindow);
  }
  if (policy.useLearnedProfile && policy.learnedProfile && learnedGate(policy.learnedProfile)) {
    return isV2LearnedSendWindowAllowed(localNow, policy.learnedProfile.preferred_window);
  }
  return true;
}

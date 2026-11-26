/**
 * Read-only current-week accountability event tapes.
 * No English interpretation. No week score. No pattern labels.
 *
 * Queries are week-scoped before any cap. Rows outside the week are not the
 * fetch window. The historical Weekly reader keeps the oldest 50 in-week rows.
 * The Sunday delivery tape keeps the newest 50 qualifying rows and presents
 * them chronologically. Fifty events are not complete weekly history when
 * older rows were omitted.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const WEEKLY_ACCOUNTABILITY_EVENT_TYPES = [
  "user_yes",
  "user_no",
  "user_partial",
] as const;

export type WeeklyAccountabilityEventType =
  (typeof WEEKLY_ACCOUNTABILITY_EVENT_TYPES)[number];

export type WeeklyAccountabilityEventV1 = {
  event_type: WeeklyAccountabilityEventType;
  occurred_at: string;
  local_day_key: string;
  source: string | null;
  user_visible_proof_line: string | null;
};

/** Cap after the week filter. Sunday keeps the newest 50. The historical Weekly reader keeps the oldest 50. */
export const WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP = 50;

function isOutcomeType(raw: string): raw is WeeklyAccountabilityEventType {
  return (
    raw === "user_yes" || raw === "user_no" || raw === "user_partial"
  );
}

function proofLineFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const line = (payload as Record<string, unknown>).user_visible_proof_line;
  if (typeof line !== "string") return null;
  const t = line.trim();
  return t ? t : null;
}

function sourceFromRow(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function localWallParts(
  date: Date,
  timeZone: string
): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => {
    const v = parts.find((p) => p.type === type)?.value;
    return v != null ? Number(v) : NaN;
  };
  let h = get("hour");
  if (h === 24) h = 0;
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h,
    min: get("minute"),
    s: get("second"),
  };
}

function utcInstantForLocalMidnight(dateKey: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const desiredAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utcMs = desiredAsUtc;
  for (let i = 0; i < 8; i++) {
    const wall = localWallParts(new Date(utcMs), timeZone);
    if (![wall.y, wall.m, wall.d, wall.h, wall.min, wall.s].every(Number.isFinite)) {
      return null;
    }
    const actualAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min, wall.s);
    const delta = desiredAsUtc - actualAsUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  const resolved = new Date(utcMs);
  if (getDateKeyInTimezone(resolved, timeZone) !== dateKey) return null;
  return resolved;
}

/**
 * Member-local Monday 00:00:00 inclusive through next Monday 00:00:00 exclusive,
 * converted to UTC instants for `occurred_at` filtering.
 */
export function weeklyAccountabilityWeekUtcRange(args: {
  weekStartLocalDate: string;
  weekEndLocalDate: string;
  timezone: string;
}): { weekStartUtcIso: string; nextWeekStartUtcIso: string } | null {
  const weekStart = args.weekStartLocalDate.trim();
  const weekEnd = args.weekEndLocalDate.trim();
  if (!weekStart || !weekEnd) return null;
  const weekStartUtc = utcInstantForLocalMidnight(weekStart, args.timezone);
  const nextWeekStartUtc = utcInstantForLocalMidnight(
    addCalendarDays(weekEnd, 1),
    args.timezone
  );
  if (!weekStartUtc || !nextWeekStartUtc) return null;
  if (!(weekStartUtc.getTime() < nextWeekStartUtc.getTime())) return null;
  return {
    weekStartUtcIso: weekStartUtc.toISOString(),
    nextWeekStartUtcIso: nextWeekStartUtc.toISOString(),
  };
}

/** Monday through the intended Sunday, using the date key itself. */
export function mondayThroughSundayEnding(sundayLocalDate: string): {
  weekStartLocalDate: string;
  weekEndLocalDate: string;
} | null {
  const weekEnd = sundayLocalDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) return null;
  const [y, m, d] = weekEnd.split("-").map((part) => Number(part));
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
  if (weekday !== "Sunday") return null;
  return {
    weekStartLocalDate: addCalendarDays(weekEnd, -6),
    weekEndLocalDate: weekEnd,
  };
}

/**
 * Drop events that have not occurred, then keep the newest `cap` rows.
 * The result is chronological: occurred_at, then id.
 * The cutoff is the read time, not the later delivery instant.
 * When older rows are omitted, this is not the complete weekly history.
 */
export function selectAccountabilityEventsBeforeCap<T extends { occurred_at: string; id?: string }>(
  rows: T[],
  availableThroughMs: number,
  cap: number = WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP
): T[] {
  const occurred = rows.filter((row) => {
    const ms = Date.parse(row.occurred_at);
    return Number.isFinite(ms) && ms <= availableThroughMs;
  });
  occurred.sort((a, b) => {
    const delta = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
    if (delta !== 0) return delta;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  const limit = Math.max(0, cap);
  if (occurred.length <= limit) return occurred;
  return occurred.slice(occurred.length - limit);
}

export type SundayAccountabilityTape =
  | {
      status: "loaded";
      events: Array<WeeklyAccountabilityEventV1 & { id: string }>;
    }
  | { status: "unavailable" };

/**
 * Current-week tape for an intended Sunday delivery.
 * The availability cutoff and outcome filters run before the 50-row cap.
 * The cap keeps the newest qualifying rows. They are returned chronologically.
 * A database error is unavailable, not an empty tape.
 * More than 50 qualifying events means older events in the week were omitted.
 */
export async function loadSundayAccountabilityTape(args: {
  commitmentId: string;
  clerkUserId: string;
  timezone: string;
  weekStartLocalDate: string;
  weekEndLocalDate: string;
  availableThrough: Date;
}): Promise<SundayAccountabilityTape> {
  const range = weeklyAccountabilityWeekUtcRange({
    weekStartLocalDate: args.weekStartLocalDate,
    weekEndLocalDate: args.weekEndLocalDate,
    timezone: args.timezone,
  });
  if (!range) return { status: "unavailable" };
  const availableThroughMs = args.availableThrough.getTime();
  if (!Number.isFinite(availableThroughMs)) return { status: "unavailable" };
  const availableThroughIso = new Date(availableThroughMs).toISOString();
  const upper =
    availableThroughIso < range.nextWeekStartUtcIso
      ? availableThroughIso
      : range.nextWeekStartUtcIso;

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, source, payload_json")
    .eq("commitment_id", args.commitmentId)
    .eq("clerk_user_id", args.clerkUserId)
    .in("event_type", [...WEEKLY_ACCOUNTABILITY_EVENT_TYPES])
    .gte("occurred_at", range.weekStartUtcIso)
    .lte("occurred_at", upper)
    .lt("occurred_at", range.nextWeekStartUtcIso)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP);

  if (error) {
    console.warn("[weekly-tto-accountability-events] sunday tape load failed", {
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return { status: "unavailable" };
  }

  const mapped: Array<WeeklyAccountabilityEventV1 & { id: string }> = [];
  for (const row of data ?? []) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const eventType = typeof row.event_type === "string" ? row.event_type : "";
    if (!id || !isOutcomeType(eventType)) continue;
    const occurredAt = typeof row.occurred_at === "string" ? row.occurred_at : "";
    const occurredMs = Date.parse(occurredAt);
    if (!occurredAt || !Number.isFinite(occurredMs) || occurredMs > availableThroughMs) continue;
    const localDayKey = getDateKeyInTimezone(new Date(occurredMs), args.timezone);
    if (localDayKey < args.weekStartLocalDate || localDayKey > args.weekEndLocalDate) continue;
    mapped.push({
      id,
      event_type: eventType,
      occurred_at: occurredAt,
      local_day_key: localDayKey,
      source: sourceFromRow(row.source),
      user_visible_proof_line: proofLineFromPayload(row.payload_json),
    });
  }
  return {
    status: "loaded",
    events: selectAccountabilityEventsBeforeCap(mapped, availableThroughMs),
  };
}

export async function loadWeeklyAccountabilityEventsReadOnly(args: {
  commitmentId: string;
  clerkUserId: string;
  timezone: string;
  weekStartLocalDate: string;
  weekEndLocalDate: string;
}): Promise<WeeklyAccountabilityEventV1[]> {
  const weekStart = args.weekStartLocalDate.trim();
  const weekEnd = args.weekEndLocalDate.trim();
  if (!weekStart || !weekEnd) return [];

  const range = weeklyAccountabilityWeekUtcRange({
    weekStartLocalDate: weekStart,
    weekEndLocalDate: weekEnd,
    timezone: args.timezone,
  });
  if (!range) return [];

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, source, payload_json")
    .eq("commitment_id", args.commitmentId)
    .eq("clerk_user_id", args.clerkUserId)
    .in("event_type", [...WEEKLY_ACCOUNTABILITY_EVENT_TYPES])
    .gte("occurred_at", range.weekStartUtcIso)
    .lt("occurred_at", range.nextWeekStartUtcIso)
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(WEEKLY_ACCOUNTABILITY_IN_WEEK_EVENT_CAP);

  if (error) {
    console.warn("[weekly-tto-accountability-events] load failed", {
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return [];
  }

  const out: WeeklyAccountabilityEventV1[] = [];
  for (const row of data ?? []) {
    const eventType = typeof row.event_type === "string" ? row.event_type : "";
    if (!isOutcomeType(eventType)) continue;
    const occurredAt = typeof row.occurred_at === "string" ? row.occurred_at : "";
    if (!occurredAt) continue;
    const occurred = new Date(occurredAt);
    if (!Number.isFinite(occurred.getTime())) continue;
    const localDayKey = getDateKeyInTimezone(occurred, args.timezone);
    if (localDayKey < weekStart || localDayKey > weekEnd) continue;
    out.push({
      event_type: eventType,
      occurred_at: occurredAt,
      local_day_key: localDayKey,
      source: sourceFromRow(row.source),
      user_visible_proof_line: proofLineFromPayload(row.payload_json),
    });
  }
  return out;
}

export async function loadWeeklyCoachingMemoryProjectionReadOnly(args: {
  commitmentId: string;
}): Promise<{
  authority: "non_authoritative_projection";
  coaching_summary: string | null;
} | null> {
  try {
    const { data, error } = await supabaseServer
      .from("v2_commitment_coaching_memory")
      .select("coaching_summary")
      .eq("commitment_id", args.commitmentId)
      .maybeSingle();
    if (error) {
      console.warn("[weekly-tto-accountability-events] coaching memory load failed", {
        commitment_id: args.commitmentId,
        message: error.message,
      });
      return null;
    }
    if (!data) return null;
    const summary =
      typeof data.coaching_summary === "string" && data.coaching_summary.trim()
        ? data.coaching_summary.trim()
        : null;
    return {
      authority: "non_authoritative_projection",
      coaching_summary: summary,
    };
  } catch (err) {
    console.warn("[weekly-tto-accountability-events] coaching memory load failed", {
      commitment_id: args.commitmentId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * E8 — Observe-only Morning vs Evening reply reporting (admin).
 * Person-first attribution. Never imported by send/generation/scheduling.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { isSmsComplianceOnlyInbound } from "@/lib/v2-commitment-sms-thread-memory";

export const TTO_REPLY_REPORT_MAX_ATTRIBUTION_MS = 36 * 60 * 60 * 1000;
export const TTO_REPLY_REPORT_DEFAULT_RANGE = "30" as const;

export type TtoReplyReportRange = "7" | "30" | "all";

export type TtoReplyReportSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

export type TtoReplyReportSlotStats = {
  sentCount: number;
  repliedCount: number;
  /** null when sentCount === 0 */
  replyRate: number | null;
  /** null when repliedCount === 0 */
  medianReplyLatencyMs: number | null;
  /** null when repliedCount === 0 */
  averageReplyLatencyMs: number | null;
};

export type TtoReplyReportMemberRow = {
  clerkUserId: string;
  displayName: string;
  morning: TtoReplyReportSlotStats;
  evening: TtoReplyReportSlotStats;
};

export type TtoReplyReportWeekdayRow = {
  weekday: string;
  weekdayIndex: number;
  morningSent: number;
  morningReplied: number;
  eveningSent: number;
  eveningReplied: number;
};

export type TtoReplyReportDetailRow = {
  clerkUserId: string;
  displayName: string;
  dayKey: string;
  slot: TtoReplyReportSlot;
  outboundSentAt: string;
  outboundBodyPreview: string;
  replied: boolean;
  replyAt: string | null;
  replyBodyPreview: string | null;
  replyLatencyMs: number | null;
};

export type TtoReplyReportResult = {
  range: TtoReplyReportRange;
  generatedAt: string;
  overall: {
    morning: TtoReplyReportSlotStats;
    evening: TtoReplyReportSlotStats;
  };
  members: TtoReplyReportMemberRow[];
  weekdays: TtoReplyReportWeekdayRow[];
  details: TtoReplyReportDetailRow[];
};

/** Normalized Morning/Evening outbound candidate (SID-backed). */
export type TtoReplyReportOutbound = {
  id: string;
  clerkUserId: string;
  dayKey: string;
  slot: TtoReplyReportSlot;
  sentAtMs: number;
  sentAtIso: string;
  body: string;
};

/** Proactive boundary (Morning/Evening/Weekly) — closes attribution only. */
export type TtoReplyReportBoundary = {
  clerkUserId: string;
  sentAtMs: number;
  kind: "morning" | "evening" | "weekly";
};

export type TtoReplyReportInbound = {
  clerkUserId: string;
  receivedAtMs: number;
  receivedAtIso: string;
  rawBody: string;
};

export type TtoReplyReportAttributed = TtoReplyReportOutbound & {
  replied: boolean;
  replyAtIso: string | null;
  replyBody: string | null;
  replyLatencyMs: number | null;
  attributionEndMs: number;
};

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const BODY_PREVIEW_MAX = 120;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseTtoReplyReportRange(raw: unknown): TtoReplyReportRange {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (t === "7" || t === "7d" || t === "7days") return "7";
  if (t === "all" || t === "alltime" || t === "all-time") return "all";
  return TTO_REPLY_REPORT_DEFAULT_RANGE;
}

export function ttoReplyReportRangeStartMs(
  range: TtoReplyReportRange,
  now: Date
): number | null {
  if (range === "all") return null;
  const days = range === "7" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

export function hasNonblankTwilioMessageSid(row: {
  message_sid?: unknown;
  metadata?: unknown;
}): boolean {
  if (typeof row.message_sid === "string" && row.message_sid.trim()) return true;
  const meta = asRecord(row.metadata);
  if (!meta) return false;
  for (const key of ["message_sid", "twilio_message_sid", "outbound_message_sid"] as const) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

export function resolveSendEventSentAtMs(row: {
  created_at?: unknown;
  metadata?: unknown;
}): number | null {
  const meta = asRecord(row.metadata);
  const metaSent = meta && typeof meta.sent_at === "string" ? meta.sent_at.trim() : "";
  if (metaSent) {
    const ms = Date.parse(metaSent);
    if (Number.isFinite(ms)) return ms;
  }
  if (typeof row.created_at === "string" && row.created_at.trim()) {
    const ms = Date.parse(row.created_at);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function resolveSendEventBody(row: {
  sms_body?: unknown;
  metadata?: unknown;
}): string {
  const meta = asRecord(row.metadata);
  if (meta) {
    for (const key of ["final_body_sent", "final_sms_body", "sms_body"] as const) {
      const v = meta[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (typeof row.sms_body === "string" && row.sms_body.trim()) return row.sms_body.trim();
  return "";
}

export function previewSmsBody(body: string, max = BODY_PREVIEW_MAX): string {
  const t = body.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function formatReplyLatencyMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatReplyRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatRepliesOverSent(replied: number, sent: number): string {
  return `${replied} replies / ${sent} texts`;
}

export function weekdayLongFromDayKey(dayKey: string): { weekday: string; index: number } {
  const parts = dayKey.trim().split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return { weekday: "Unknown", index: 99 };
  }
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
  const index = WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number]);
  return { weekday, index: index >= 0 ? index : 99 };
}

export function medianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function averageMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export function emptySlotStats(): TtoReplyReportSlotStats {
  return {
    sentCount: 0,
    repliedCount: 0,
    replyRate: null,
    medianReplyLatencyMs: null,
    averageReplyLatencyMs: null,
  };
}

export function buildSlotStats(args: {
  sentCount: number;
  latenciesMs: number[];
}): TtoReplyReportSlotStats {
  const repliedCount = args.latenciesMs.length;
  if (args.sentCount <= 0) return emptySlotStats();
  return {
    sentCount: args.sentCount,
    repliedCount,
    replyRate: repliedCount / args.sentCount,
    medianReplyLatencyMs: medianMs(args.latenciesMs),
    averageReplyLatencyMs: averageMs(args.latenciesMs),
  };
}

function normalizeMeSlot(raw: unknown): TtoReplyReportSlot | null {
  if (raw === SMS_DAILY_PRODUCTION_SEND_SLOT) return SMS_DAILY_PRODUCTION_SEND_SLOT;
  if (raw === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) return SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
  return null;
}

export function normalizeMorningEveningOutbound(
  row: Record<string, unknown>
): TtoReplyReportOutbound | null {
  const slot = normalizeMeSlot(row.send_slot);
  if (!slot) return null;
  if (!hasNonblankTwilioMessageSid(row)) return null;
  const sentAtMs = resolveSendEventSentAtMs(row);
  if (sentAtMs == null) return null;
  const clerkUserId =
    typeof row.clerk_user_id === "string" ? row.clerk_user_id.trim() : "";
  if (!clerkUserId) return null;
  const id = typeof row.id === "string" ? row.id : `${clerkUserId}:${slot}:${sentAtMs}`;
  const dayKey = typeof row.day_key === "string" ? row.day_key.trim() : "";
  return {
    id,
    clerkUserId,
    dayKey,
    slot,
    sentAtMs,
    sentAtIso: new Date(sentAtMs).toISOString(),
    body: resolveSendEventBody(row),
  };
}

export function normalizeWeeklyBoundary(
  row: Record<string, unknown>
): TtoReplyReportBoundary | null {
  if (!hasNonblankTwilioMessageSid(row)) return null;
  const sentAtMs = resolveSendEventSentAtMs(row);
  if (sentAtMs == null) return null;
  const clerkUserId =
    typeof row.clerk_user_id === "string" ? row.clerk_user_id.trim() : "";
  if (!clerkUserId) return null;
  return { clerkUserId, sentAtMs, kind: "weekly" };
}

export function normalizeInboundForReplyReport(row: {
  clerk_user_id?: unknown;
  received_at?: unknown;
  raw_body?: unknown;
}): TtoReplyReportInbound | null {
  const clerkUserId =
    typeof row.clerk_user_id === "string" ? row.clerk_user_id.trim() : "";
  if (!clerkUserId) return null;
  if (typeof row.received_at !== "string" || !row.received_at.trim()) return null;
  const receivedAtMs = Date.parse(row.received_at);
  if (!Number.isFinite(receivedAtMs)) return null;
  const rawBody = typeof row.raw_body === "string" ? row.raw_body : "";
  if (isSmsComplianceOnlyInbound(rawBody)) return null;
  return {
    clerkUserId,
    receivedAtMs,
    receivedAtIso: new Date(receivedAtMs).toISOString(),
    rawBody,
  };
}

/**
 * Pure attribution: first qualifying inbound after outbound and before attribution end.
 * Strict received_at > sentAt. Same-instant inbound is not attributed.
 */
export function attributeMorningEveningReplies(args: {
  outbounds: TtoReplyReportOutbound[];
  boundaries: TtoReplyReportBoundary[];
  inbounds: TtoReplyReportInbound[];
}): TtoReplyReportAttributed[] {
  const boundariesByUser = new Map<string, number[]>();
  for (const b of args.boundaries) {
    const list = boundariesByUser.get(b.clerkUserId) ?? [];
    list.push(b.sentAtMs);
    boundariesByUser.set(b.clerkUserId, list);
  }
  for (const [, list] of boundariesByUser) {
    list.sort((a, b) => a - b);
  }

  const inboundsByUser = new Map<string, TtoReplyReportInbound[]>();
  for (const inbound of args.inbounds) {
    const list = inboundsByUser.get(inbound.clerkUserId) ?? [];
    list.push(inbound);
    inboundsByUser.set(inbound.clerkUserId, list);
  }
  for (const [, list] of inboundsByUser) {
    list.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  }

  const outbounds = [...args.outbounds].sort((a, b) => {
    if (a.sentAtMs !== b.sentAtMs) return a.sentAtMs - b.sentAtMs;
    return a.id.localeCompare(b.id);
  });

  const attributed: TtoReplyReportAttributed[] = [];

  for (const outbound of outbounds) {
    const maxBoundaryAt = outbound.sentAtMs + TTO_REPLY_REPORT_MAX_ATTRIBUTION_MS;
    const userBoundaries = boundariesByUser.get(outbound.clerkUserId) ?? [];
    let nextBoundaryAt: number | null = null;
    for (const t of userBoundaries) {
      if (t > outbound.sentAtMs) {
        nextBoundaryAt = t;
        break;
      }
    }
    const attributionEndMs =
      nextBoundaryAt == null ? maxBoundaryAt : Math.min(nextBoundaryAt, maxBoundaryAt);

    const userInbounds = inboundsByUser.get(outbound.clerkUserId) ?? [];
    let match: TtoReplyReportInbound | null = null;
    for (const inbound of userInbounds) {
      if (inbound.receivedAtMs <= outbound.sentAtMs) continue;
      if (inbound.receivedAtMs >= attributionEndMs) break;
      match = inbound;
      break;
    }

    if (match) {
      attributed.push({
        ...outbound,
        replied: true,
        replyAtIso: match.receivedAtIso,
        replyBody: match.rawBody,
        replyLatencyMs: match.receivedAtMs - outbound.sentAtMs,
        attributionEndMs,
      });
    } else {
      attributed.push({
        ...outbound,
        replied: false,
        replyAtIso: null,
        replyBody: null,
        replyLatencyMs: null,
        attributionEndMs,
      });
    }
  }

  return attributed;
}

export function aggregateAttributedReplyReport(args: {
  range: TtoReplyReportRange;
  generatedAt: Date;
  attributed: TtoReplyReportAttributed[];
  displayNameByUserId: Map<string, string>;
}): TtoReplyReportResult {
  const byUser = new Map<
    string,
    {
      morningLatencies: number[];
      eveningLatencies: number[];
      morningSent: number;
      eveningSent: number;
    }
  >();

  const weekdayMap = new Map<
    string,
    {
      weekday: string;
      index: number;
      morningSent: number;
      morningReplied: number;
      eveningSent: number;
      eveningReplied: number;
    }
  >();

  const overallMorningLatencies: number[] = [];
  const overallEveningLatencies: number[] = [];
  let overallMorningSent = 0;
  let overallEveningSent = 0;

  const details: TtoReplyReportDetailRow[] = [];

  for (const row of args.attributed) {
    const bucket = byUser.get(row.clerkUserId) ?? {
      morningLatencies: [],
      eveningLatencies: [],
      morningSent: 0,
      eveningSent: 0,
    };
    if (row.slot === SMS_DAILY_PRODUCTION_SEND_SLOT) {
      bucket.morningSent += 1;
      overallMorningSent += 1;
      if (row.replied && row.replyLatencyMs != null) {
        bucket.morningLatencies.push(row.replyLatencyMs);
        overallMorningLatencies.push(row.replyLatencyMs);
      }
    } else {
      bucket.eveningSent += 1;
      overallEveningSent += 1;
      if (row.replied && row.replyLatencyMs != null) {
        bucket.eveningLatencies.push(row.replyLatencyMs);
        overallEveningLatencies.push(row.replyLatencyMs);
      }
    }
    byUser.set(row.clerkUserId, bucket);

    const { weekday, index } = weekdayLongFromDayKey(row.dayKey || "1970-01-01");
    const wk = weekdayMap.get(weekday) ?? {
      weekday,
      index,
      morningSent: 0,
      morningReplied: 0,
      eveningSent: 0,
      eveningReplied: 0,
    };
    if (row.slot === SMS_DAILY_PRODUCTION_SEND_SLOT) {
      wk.morningSent += 1;
      if (row.replied) wk.morningReplied += 1;
    } else {
      wk.eveningSent += 1;
      if (row.replied) wk.eveningReplied += 1;
    }
    weekdayMap.set(weekday, wk);

    const displayName =
      args.displayNameByUserId.get(row.clerkUserId)?.trim() || row.clerkUserId;
    details.push({
      clerkUserId: row.clerkUserId,
      displayName,
      dayKey: row.dayKey,
      slot: row.slot,
      outboundSentAt: row.sentAtIso,
      outboundBodyPreview: previewSmsBody(row.body),
      replied: row.replied,
      replyAt: row.replyAtIso,
      replyBodyPreview: row.replyBody != null ? previewSmsBody(row.replyBody) : null,
      replyLatencyMs: row.replyLatencyMs,
    });
  }

  const members: TtoReplyReportMemberRow[] = [...byUser.entries()]
    .map(([clerkUserId, bucket]) => ({
      clerkUserId,
      displayName: args.displayNameByUserId.get(clerkUserId)?.trim() || clerkUserId,
      morning: buildSlotStats({
        sentCount: bucket.morningSent,
        latenciesMs: bucket.morningLatencies,
      }),
      evening: buildSlotStats({
        sentCount: bucket.eveningSent,
        latenciesMs: bucket.eveningLatencies,
      }),
    }))
    .sort((a, b) => {
      const nameCmp = a.displayName.localeCompare(b.displayName);
      if (nameCmp !== 0) return nameCmp;
      return a.clerkUserId.localeCompare(b.clerkUserId);
    });

  const weekdays = [...weekdayMap.values()]
    .sort((a, b) => a.index - b.index)
    .map((w) => ({
      weekday: w.weekday,
      weekdayIndex: w.index,
      morningSent: w.morningSent,
      morningReplied: w.morningReplied,
      eveningSent: w.eveningSent,
      eveningReplied: w.eveningReplied,
    }));

  details.sort((a, b) => {
    if (a.outboundSentAt !== b.outboundSentAt) {
      return a.outboundSentAt < b.outboundSentAt ? 1 : -1;
    }
    return a.clerkUserId.localeCompare(b.clerkUserId);
  });

  return {
    range: args.range,
    generatedAt: args.generatedAt.toISOString(),
    overall: {
      morning: buildSlotStats({
        sentCount: overallMorningSent,
        latenciesMs: overallMorningLatencies,
      }),
      evening: buildSlotStats({
        sentCount: overallEveningSent,
        latenciesMs: overallEveningLatencies,
      }),
    },
    members,
    weekdays,
    details,
  };
}

async function fetchPreferredNamesByUserIds(
  clerkUserIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(clerkUserIds.map((id) => id.trim()).filter(Boolean))];
  const pageSize = 200;
  for (let i = 0; i < unique.length; i += pageSize) {
    const chunk = unique.slice(i, i + pageSize);
    const { data, error } = await supabaseServer
      .from("user_profiles")
      .select("clerk_user_id, preferred_name")
      .in("clerk_user_id", chunk);
    if (error) {
      console.warn("[tto-reply-report] preferred_name lookup failed", {
        message: error.message,
      });
      continue;
    }
    for (const row of data ?? []) {
      const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const name = typeof row.preferred_name === "string" ? row.preferred_name.trim() : "";
      if (id && name) result.set(id, name);
    }
  }
  return result;
}

async function fetchAllPages(args: {
  table: string;
  select: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any;
  orderColumn: string;
}): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let q = supabaseServer.from(args.table).select(args.select);
    q = args.apply(q);
    q = q.order(args.orderColumn, { ascending: true }).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) {
      throw new Error(`${args.table}_query_failed:${error.message}`);
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Build observe-only Morning vs Evening reply report for the admin page.
 * READ ONLY — no writes, no Twilio, no model calls.
 */
export async function buildTylerTextOverviewReplyReport(args: {
  range: TtoReplyReportRange;
  now?: Date;
}): Promise<TtoReplyReportResult> {
  const now = args.now ?? new Date();
  const rangeStartMs = ttoReplyReportRangeStartMs(args.range, now);
  const nowMs = now.getTime();

  const meRows = await fetchAllPages({
    table: "sms_send_events",
    select: "id, clerk_user_id, day_key, send_slot, message_sid, sms_body, metadata, created_at",
    orderColumn: "created_at",
    apply: (q) =>
      q
        .in("send_slot", [
          SMS_DAILY_PRODUCTION_SEND_SLOT,
          SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        ])
        .not("message_sid", "is", null)
        .neq("message_sid", ""),
  });

  const outboundsAll = meRows
    .map((row) => normalizeMorningEveningOutbound(row))
    .filter((r): r is TtoReplyReportOutbound => r != null);

  const outbounds = outboundsAll.filter((o) => {
    if (o.sentAtMs > nowMs) return false;
    if (rangeStartMs != null && o.sentAtMs < rangeStartMs) return false;
    return true;
  });

  if (outbounds.length === 0) {
    return {
      range: args.range,
      generatedAt: now.toISOString(),
      overall: { morning: emptySlotStats(), evening: emptySlotStats() },
      members: [],
      weekdays: [],
      details: [],
    };
  }

  const userIds = [...new Set(outbounds.map((o) => o.clerkUserId))];
  const horizonStartMs = Math.min(...outbounds.map((o) => o.sentAtMs));
  const horizonEndMs =
    Math.max(...outbounds.map((o) => o.sentAtMs)) + TTO_REPLY_REPORT_MAX_ATTRIBUTION_MS;
  const horizonStartIso = new Date(horizonStartMs).toISOString();
  const horizonEndIso = new Date(horizonEndMs).toISOString();

  const [weeklyRows, inboundRows, displayNameByUserId, meBoundaryExtra] =
    await Promise.all([
      fetchAllPages({
        table: "sms_weekly_send_events",
        select: "id, clerk_user_id, message_sid, metadata, created_at, status",
        orderColumn: "created_at",
        apply: (q) =>
          q
            .in("clerk_user_id", userIds)
            .not("message_sid", "is", null)
            .neq("message_sid", "")
            .gte("created_at", horizonStartIso)
            .lte("created_at", horizonEndIso),
      }),
      fetchAllPages({
        table: "sms_inbound_messages",
        select: "clerk_user_id, received_at, raw_body, message_sid",
        orderColumn: "received_at",
        apply: (q) =>
          q
            .in("clerk_user_id", userIds)
            .gte("received_at", horizonStartIso)
            .lte("received_at", horizonEndIso),
      }),
      fetchPreferredNamesByUserIds(userIds),
      fetchAllPages({
        table: "sms_send_events",
        select:
          "id, clerk_user_id, day_key, send_slot, message_sid, sms_body, metadata, created_at",
        orderColumn: "created_at",
        apply: (q) =>
          q
            .in("clerk_user_id", userIds)
            .in("send_slot", [
              SMS_DAILY_PRODUCTION_SEND_SLOT,
              SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
            ])
            .not("message_sid", "is", null)
            .neq("message_sid", "")
            .gte("created_at", horizonStartIso)
            .lte("created_at", horizonEndIso),
      }),
    ]);

  const meBoundariesFromHorizon = meBoundaryExtra
    .map((row) => normalizeMorningEveningOutbound(row))
    .filter((r): r is TtoReplyReportOutbound => r != null)
    .map((o) => ({
      clerkUserId: o.clerkUserId,
      sentAtMs: o.sentAtMs,
      kind:
        o.slot === SMS_DAILY_PRODUCTION_SEND_SLOT
          ? ("morning" as const)
          : ("evening" as const),
    }));

  // Include outboundsAll in horizon as boundaries even if created_at filter missed metadata.sent_at outliers
  for (const o of outboundsAll) {
    if (o.sentAtMs < horizonStartMs || o.sentAtMs > horizonEndMs) continue;
    if (!userIds.includes(o.clerkUserId)) continue;
    meBoundariesFromHorizon.push({
      clerkUserId: o.clerkUserId,
      sentAtMs: o.sentAtMs,
      kind:
        o.slot === SMS_DAILY_PRODUCTION_SEND_SLOT
          ? ("morning" as const)
          : ("evening" as const),
    });
  }

  const weeklyBoundaries = weeklyRows
    .map((row) => normalizeWeeklyBoundary(row))
    .filter((r): r is TtoReplyReportBoundary => r != null)
    .filter((b) => b.sentAtMs >= horizonStartMs && b.sentAtMs <= horizonEndMs);

  const boundaries = [...meBoundariesFromHorizon, ...weeklyBoundaries];

  const inbounds = inboundRows
    .map((row) => normalizeInboundForReplyReport(row))
    .filter((r): r is TtoReplyReportInbound => r != null);

  const attributed = attributeMorningEveningReplies({
    outbounds,
    boundaries,
    inbounds,
  });

  return aggregateAttributedReplyReport({
    range: args.range,
    generatedAt: now,
    attributed,
    displayNameByUserId,
  });
}

/**
 * Relationship Packet v1.6 — true 72-hour exact SMS thread (read-only, no schema).
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getRecentV2EventsForAi, type V2EventRowForAi } from "@/lib/v2-commitment";
import { getLocalDayKeyForTimestamp } from "@/lib/sms-temporal-contract-v1";
import { resolveUserTimezone } from "@/lib/timezone";

export const RECENT_EXACT_THREAD_WINDOW_HOURS = 72;
export const RECENT_EXACT_THREAD_WINDOW_MS = RECENT_EXACT_THREAD_WINDOW_HOURS * 60 * 60 * 1000;

export type RecentExactThread72hRole = "coach" | "user" | "system_no_send";

export type RecentExactThread72hDeliveryStatus =
  | "sent"
  | "cancelled"
  | "skipped"
  | "preview"
  | "unknown";

export type RecentExactThread72hMessage = {
  at: string;
  at_local: string;
  at_local_timezone: string;
  local_day_key: string;
  role: RecentExactThread72hRole;
  body: string;
  message_kind: string | null;
  source_table: string;
  message_sid: string | null;
  delivery_status: RecentExactThread72hDeliveryStatus;
  is_exact_body: boolean;
  body_truncated?: boolean;
};

export type RecentExactThread72hResult = {
  messages: RecentExactThread72hMessage[];
  window_hours: typeof RECENT_EXACT_THREAD_WINDOW_HOURS;
  message_count: number;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  oldest_at?: string;
  newest_at?: string;
};

type TimelineEntry = {
  t: number;
  role: RecentExactThread72hRole;
  body: string;
  source_table: string;
  message_kind: string | null;
  message_sid: string | null;
  delivery_status: RecentExactThread72hDeliveryStatus;
  is_exact_body: boolean;
  body_truncated: boolean;
  priority: number;
};

const DEDUPE_WINDOW_MS = 5000;
const NEAR_EXACT_SEND_MS = 120_000;
const ROW_FETCH_LIMIT = 120;
const PER_MESSAGE_SAFETY_CAP = 8000;
const COACHING_OUTBOUND_KINDS = new Set(["coach", "question", "quote", "nudge", "weekly"]);

const SKIPPED_SEND_STATUSES = new Set([
  "reserved",
  "cancelled",
  "skipped",
  "skipped_no_safe_v3_voice",
  "skipped_already_completed",
  "skipped_active_inbound_thread",
  "skipped_reactivation_cooldown",
  "skipped_v2_refresh_identity_pending",
  "skipped_pending_resolution_recent_confirm",
  "skipped_not_fully_on_v2",
  "skipped_missing_twilio",
  "skipped_user_pause",
  "skipped_legacy_followup_deprecated",
  "skipped_legacy_weekly_deprecated",
]);

function stripComplianceFooter(text: string): string {
  return text
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
}

function normDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isComplianceInbound(raw: string): boolean {
  const low = raw.trim().toLowerCase();
  return /^(stop|start|help|unstop|cancel)$/i.test(low) && raw.trim().length <= 12;
}

function bodyFromSendEventRow(row: Record<string, unknown>): string {
  if (typeof row.sms_body === "string" && row.sms_body.trim()) return row.sms_body.trim();
  if (typeof row.body === "string" && row.body.trim()) return row.body.trim();
  if (typeof row.message_body === "string" && row.message_body.trim()) return row.message_body.trim();
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.sms_body === "string" && m.sms_body.trim()) return m.sms_body.trim();
  }
  return "";
}

function messageSidFromSendEventRow(row: Record<string, unknown>): string | null {
  if (typeof row.message_sid === "string" && row.message_sid.trim()) return row.message_sid.trim();
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.message_sid === "string" && m.message_sid.trim()) return m.message_sid.trim();
  }
  return null;
}

export function isSendEventTrulySent(row: Record<string, unknown>): boolean {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (SKIPPED_SEND_STATUSES.has(status) || status.startsWith("skipped_")) return false;
  if (status === "sent" || status === "dry_run") return true;
  const sid = messageSidFromSendEventRow(row);
  if (sid) return true;
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (m.twilio_send_attempted === true) return true;
  }
  return false;
}

function safeBody(raw: string): { body: string; body_truncated: boolean } {
  const cleaned = raw.trim().replace(/\r?\n/g, " ");
  if (cleaned.length <= PER_MESSAGE_SAFETY_CAP) {
    return { body: cleaned, body_truncated: false };
  }
  return { body: `${cleaned.slice(0, PER_MESSAGE_SAFETY_CAP - 1)}…`, body_truncated: true };
}

export function formatAtLocal(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function dedupeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  const sorted = [...entries].sort((a, b) => a.t - b.t || b.priority - a.priority);
  const sidSeen = new Set<string>();
  const out: TimelineEntry[] = [];

  for (const e of sorted) {
    if (e.message_sid) {
      if (sidSeen.has(e.message_sid)) continue;
      sidSeen.add(e.message_sid);
    }

    let replaced = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 8; i--) {
      const prev = out[i]!;
      if (prev.role !== e.role) continue;
      if (Math.abs(e.t - prev.t) > DEDUPE_WINDOW_MS) break;
      if (normDedupeKey(prev.body) !== normDedupeKey(e.body)) continue;
      if (e.priority >= prev.priority) out[i] = e;
      replaced = true;
      break;
    }
    if (!replaced) out.push(e);
  }

  return out.sort((a, b) => a.t - b.t);
}

function toOutputMessage(entry: TimelineEntry, timezone: string): RecentExactThread72hMessage {
  const d = new Date(entry.t);
  return {
    at: d.toISOString(),
    at_local: formatAtLocal(d, timezone),
    at_local_timezone: timezone,
    local_day_key: getLocalDayKeyForTimestamp(d, timezone),
    role: entry.role,
    body: entry.body,
    message_kind: entry.message_kind,
    source_table: entry.source_table,
    message_sid: entry.message_sid,
    delivery_status: entry.delivery_status,
    is_exact_body: entry.is_exact_body,
    ...(entry.body_truncated ? { body_truncated: true } : {}),
  };
}

export const BRIEF_THREAD_FLOOR_HOURS = 72;
export const BRIEF_THREAD_EXTENSION_DAYS = 7;
export const BRIEF_THREAD_EXTENSION_MS = BRIEF_THREAD_EXTENSION_DAYS * 24 * 60 * 60 * 1000;
export const BRIEF_THREAD_MAX_MESSAGES = 25;
export const BRIEF_THREAD_MAX_CHARS = 5000;
export const BRIEF_THREAD_PER_MESSAGE_MAX = 320;

export type RecentExactThreadBriefMessage = {
  at_local: string;
  role: "coach" | "user";
  body: string;
};

export type RecentExactThreadForBriefResult = {
  window: {
    floor_hours: typeof BRIEF_THREAD_FLOOR_HOURS;
    extension_days: typeof BRIEF_THREAD_EXTENSION_DAYS;
    mode: "72h_floor_7d_extension_capped";
  };
  messages: RecentExactThreadBriefMessage[];
  message_count: number;
  char_count: number;
  /** Full 7d timeline for coach-body freshness extraction. */
  timeline_7d: RecentExactThread72hResult;
};

export type BuildRecentExactThreadArgs = {
  clerkUserId: string;
  commitmentId?: string | null;
  timezone: string;
  now?: Date;
  includeSystemNoSend?: boolean;
  preloadedCheckSentEvents?: V2EventRowForAi[];
};

function isWriterFacingThreadMessage(m: RecentExactThread72hMessage): boolean {
  if (m.role === "user") return true;
  if (m.role === "coach") return m.delivery_status === "sent" && m.is_exact_body;
  return false;
}

function truncateBriefBody(body: string, max = BRIEF_THREAD_PER_MESSAGE_MAX): string {
  const t = body.trim().replace(/\r?\n/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function briefThreadMessageCharCount(messages: RecentExactThreadBriefMessage[]): number {
  return messages.reduce((sum, m) => sum + m.body.length, 0);
}

function toBriefMessage(m: RecentExactThread72hMessage): RecentExactThreadBriefMessage {
  return {
    at_local: m.at_local,
    role: m.role === "coach" ? "coach" : "user",
    body: truncateBriefBody(m.body),
  };
}

/** Cap writer-facing thread: 72h floor preserved, 7d extension until message/char caps. */
export function capThreadMessagesForBrief(
  messages: RecentExactThread72hMessage[],
  nowMs: number
): RecentExactThreadBriefMessage[] {
  const floorMs = nowMs - BRIEF_THREAD_FLOOR_HOURS * 60 * 60 * 1000;

  type Item = { msg: RecentExactThread72hMessage; ts: number; isFloor: boolean };
  const items: Item[] = [];
  for (const m of messages) {
    if (!isWriterFacingThreadMessage(m)) continue;
    const ts = Date.parse(m.at);
    if (!Number.isFinite(ts)) continue;
    items.push({ msg: m, ts, isFloor: ts >= floorMs });
  }
  items.sort((a, b) => a.ts - b.ts);

  const floorItems = items.filter((i) => i.isFloor);
  const extensionItems = items.filter((i) => !i.isFloor);

  let chosen: Item[] = [...floorItems];
  for (const ext of extensionItems) {
    const candidate = [...chosen, ext];
    const brief = candidate.map((i) => toBriefMessage(i.msg));
    if (brief.length > BRIEF_THREAD_MAX_MESSAGES) break;
    if (briefThreadMessageCharCount(brief) > BRIEF_THREAD_MAX_CHARS) break;
    chosen = candidate;
  }

  let briefMsgs = chosen.map((i) => toBriefMessage(i.msg));

  const shrinkLongestCoachBody = (startIdx: number): boolean => {
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = startIdx; i < briefMsgs.length; i++) {
      const m = briefMsgs[i]!;
      if (m.role !== "coach" || m.body.length <= 80) continue;
      if (m.body.length > bestLen) {
        bestLen = m.body.length;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return false;
    const cur = briefMsgs[bestIdx]!;
    const nextLen = Math.max(80, Math.floor(cur.body.length * 0.65));
    briefMsgs[bestIdx] = { ...cur, body: truncateBriefBody(cur.body, nextLen) };
    return true;
  };

  while (briefThreadMessageCharCount(briefMsgs) > BRIEF_THREAD_MAX_CHARS) {
    if (shrinkLongestCoachBody(floorItems.length)) continue;
    if (shrinkLongestCoachBody(0)) continue;
    if (chosen.length > floorItems.length) {
      chosen = chosen.slice(0, -1);
      briefMsgs = chosen.map((i) => toBriefMessage(i.msg));
      continue;
    }
    break;
  }

  return briefMsgs;
}

export type BriefThreadWindowTelemetry = {
  daily_brief_thread_floor_message_count: number;
  daily_brief_thread_extension_message_count: number;
  daily_brief_thread_oldest_at_local: string | null;
  daily_brief_thread_newest_at_local: string | null;
};

/** Compact thread-window gauges for SQL (no message bodies). */
export function deriveBriefThreadWindowTelemetry(
  messages: RecentExactThread72hMessage[],
  nowMs: number
): BriefThreadWindowTelemetry {
  const floorMs = nowMs - BRIEF_THREAD_FLOOR_HOURS * 60 * 60 * 1000;
  const capped = capThreadMessagesForBrief(messages, nowMs);
  let floorCount = 0;
  let extensionCount = 0;

  for (const cap of capped) {
    const match = messages.find(
      (m) =>
        isWriterFacingThreadMessage(m) &&
        m.at_local === cap.at_local &&
        (m.role === "coach" ? "coach" : "user") === cap.role
    );
    if (!match) continue;
    const ts = Date.parse(match.at);
    if (Number.isFinite(ts) && ts >= floorMs) floorCount += 1;
    else extensionCount += 1;
  }

  return {
    daily_brief_thread_floor_message_count: floorCount,
    daily_brief_thread_extension_message_count: extensionCount,
    daily_brief_thread_oldest_at_local: capped[0]?.at_local ?? null,
    daily_brief_thread_newest_at_local: capped[capped.length - 1]?.at_local ?? null,
  };
}

async function buildRecentExactThreadWithWindowMs(
  args: BuildRecentExactThreadArgs & { windowMs: number }
): Promise<RecentExactThread72hResult> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - args.windowMs;
  const tz = resolveUserTimezone(args.timezone);
  const includeSystemNoSend = args.includeSystemNoSend === true;

  const [
    { data: inboundMsgRows },
    { data: sendRows },
    { data: coachJobRows },
    { data: lastCtx },
  ] = await Promise.all([
    supabaseServer
      .from("sms_inbound_messages")
      .select("raw_body, created_at, message_sid")
      .eq("clerk_user_id", args.clerkUserId)
      .order("created_at", { ascending: false })
      .limit(ROW_FETCH_LIMIT),
    supabaseServer
      .from("sms_send_events")
      .select("sms_body, body, message_body, created_at, metadata, status, message_sid")
      .eq("clerk_user_id", args.clerkUserId)
      .order("created_at", { ascending: false })
      .limit(ROW_FETCH_LIMIT),
    supabaseServer
      .from("sms_inbound_coach_jobs")
      .select(
        "raw_body, reply_body, sent_at, updated_at, created_at, message_sid, status, outbound_message_sid"
      )
      .eq("clerk_user_id", args.clerkUserId)
      .order("updated_at", { ascending: false })
      .limit(ROW_FETCH_LIMIT),
    supabaseServer
      .from("sms_last_outbound_context")
      .select("sent_at, full_body, message_kind")
      .eq("clerk_user_id", args.clerkUserId)
      .maybeSingle(),
  ]);

  let checkSentEvents = args.preloadedCheckSentEvents;
  if (!checkSentEvents && args.commitmentId) {
    checkSentEvents = await getRecentV2EventsForAi(args.commitmentId);
  }

  const rich: TimelineEntry[] = [];
  const sendBodiesByTime = new Map<number, string>();

  for (const r of sendRows ?? []) {
    const row = r as Record<string, unknown>;
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;

    const bodyRaw = stripComplianceFooter(bodyFromSendEventRow(row));
    if (!bodyRaw) continue;

    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    const trulySent = isSendEventTrulySent(row);

    if (!trulySent) {
      if (includeSystemNoSend && bodyRaw) {
        const { body, body_truncated } = safeBody(bodyRaw);
        rich.push({
          t: ts,
          role: "system_no_send",
          body,
          source_table: "sms_send_events",
          message_kind: status || "skipped",
          message_sid: messageSidFromSendEventRow(row),
          delivery_status: status.startsWith("skipped") ? "skipped" : "cancelled",
          is_exact_body: false,
          body_truncated,
          priority: 10,
        });
      }
      continue;
    }

    sendBodiesByTime.set(ts, bodyRaw);
    const { body, body_truncated } = safeBody(bodyRaw);
    rich.push({
      t: ts,
      role: "coach",
      body,
      source_table: "sms_send_events",
      message_kind: "daily",
      message_sid: messageSidFromSendEventRow(row),
      delivery_status: "sent",
      is_exact_body: true,
      body_truncated,
      priority: 90,
    });
  }

  for (const r of coachJobRows ?? []) {
    const row = r as {
      raw_body?: string | null;
      reply_body?: string | null;
      sent_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      status?: string | null;
      message_sid?: string | null;
      outbound_message_sid?: string | null;
    };

    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    if (raw) {
      const tsRaw = row.created_at ?? row.updated_at;
      const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : 0;
      if (Number.isFinite(ts) && ts >= cutoffMs && !isComplianceInbound(raw)) {
        const { body, body_truncated } = safeBody(raw);
        rich.push({
          t: ts,
          role: "user",
          body,
          source_table: "sms_inbound_coach_jobs",
          message_kind: null,
          message_sid: row.message_sid?.trim() || null,
          delivery_status: "sent",
          is_exact_body: true,
          body_truncated,
          priority: 95,
        });
      }
    }

    const reply = typeof row.reply_body === "string" ? row.reply_body.trim() : "";
    const sentLike =
      Boolean(row.sent_at?.trim()) ||
      row.status === "sent" ||
      Boolean(row.outbound_message_sid?.trim());

    if (reply && sentLike) {
      const tsRaw = row.sent_at ?? row.updated_at ?? row.created_at;
      const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : 0;
      if (Number.isFinite(ts) && ts >= cutoffMs) {
        const { body, body_truncated } = safeBody(stripComplianceFooter(reply));
        rich.push({
          t: ts,
          role: "coach",
          body,
          source_table: "sms_inbound_coach_jobs",
          message_kind: "coach",
          message_sid: row.outbound_message_sid?.trim() || row.message_sid?.trim() || null,
          delivery_status: "sent",
          is_exact_body: true,
          body_truncated,
          priority: 100,
        });
      }
    }
  }

  for (const r of inboundMsgRows ?? []) {
    const row = r as { raw_body?: string; created_at?: string; message_sid?: string };
    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    if (!raw || !Number.isFinite(ts) || ts < cutoffMs || isComplianceInbound(raw)) continue;
    const { body, body_truncated } = safeBody(raw);
    rich.push({
      t: ts,
      role: "user",
      body,
      source_table: "sms_inbound_messages",
      message_kind: null,
      message_sid: typeof row.message_sid === "string" ? row.message_sid.trim() : null,
      delivery_status: "sent",
      is_exact_body: true,
      body_truncated,
      priority: 50,
    });
  }

  if (checkSentEvents?.length) {
    for (const e of checkSentEvents) {
      if (e.event_type !== "check_sent") continue;
      const raw = e.payload_json as Record<string, unknown> | undefined;
      const preview = typeof raw?.body_preview === "string" ? raw.body_preview.trim() : "";
      if (!preview) continue;
      const ts = new Date(e.occurred_at).getTime();
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
      const nearSend = [...sendBodiesByTime.keys()].some((st) => Math.abs(st - ts) < NEAR_EXACT_SEND_MS);
      if (nearSend) continue;
      const { body, body_truncated } = safeBody(stripComplianceFooter(preview));
      rich.push({
        t: ts,
        role: "coach",
        body,
        source_table: "v2_commitment_event_check_sent",
        message_kind: "check_sent_preview",
        message_sid: null,
        delivery_status: "preview",
        is_exact_body: false,
        body_truncated,
        priority: 60,
      });
    }
  }

  if (lastCtx && typeof (lastCtx as { sent_at?: string }).sent_at === "string") {
    const row = lastCtx as { sent_at: string; full_body?: string; message_kind?: string };
    const kind = typeof row.message_kind === "string" ? row.message_kind : "transactional";
    if (COACHING_OUTBOUND_KINDS.has(kind)) {
      const raw = typeof row.full_body === "string" ? row.full_body : "";
      const ts = new Date(row.sent_at).getTime();
      if (raw.trim() && Number.isFinite(ts) && ts >= cutoffMs) {
        const cleaned = stripComplianceFooter(raw);
        const alreadyCoach = rich.some(
          (e) =>
            e.role === "coach" &&
            e.is_exact_body &&
            Math.abs(e.t - ts) < NEAR_EXACT_SEND_MS &&
            normDedupeKey(e.body) === normDedupeKey(cleaned)
        );
        if (!alreadyCoach) {
          const { body, body_truncated } = safeBody(cleaned);
          rich.push({
            t: ts,
            role: "coach",
            body,
            source_table: "sms_last_outbound_context",
            message_kind: kind,
            message_sid: null,
            delivery_status: "sent",
            is_exact_body: true,
            body_truncated,
            priority: 35,
          });
        }
      }
    }
  }

  const merged = dedupeTimeline(rich);
  const messages = merged.map((e) => toOutputMessage(e, tz));

  const windowHours = Math.round(args.windowMs / (60 * 60 * 1000));
  return {
    messages,
    window_hours:
      windowHours === RECENT_EXACT_THREAD_WINDOW_HOURS
        ? RECENT_EXACT_THREAD_WINDOW_HOURS
        : (windowHours as typeof RECENT_EXACT_THREAD_WINDOW_HOURS),
    message_count: messages.length,
    had_preview_messages: messages.some((m) => m.delivery_status === "preview"),
    had_system_no_send: messages.some((m) => m.role === "system_no_send"),
    oldest_at: messages[0]?.at,
    newest_at: messages[messages.length - 1]?.at,
  };
}

export async function buildRecentExactThread72h(
  args: BuildRecentExactThreadArgs
): Promise<RecentExactThread72hResult> {
  return buildRecentExactThreadWithWindowMs({
    ...args,
    windowMs: RECENT_EXACT_THREAD_WINDOW_MS,
  });
}

/** 7d fetch + 72h floor / capped extension for DailySmsWritingBriefV1. */
export async function buildRecentExactThreadForBrief(
  args: BuildRecentExactThreadArgs
): Promise<RecentExactThreadForBriefResult> {
  const now = args.now ?? new Date();
  const timeline_7d = await buildRecentExactThreadWithWindowMs({
    ...args,
    windowMs: BRIEF_THREAD_EXTENSION_MS,
    includeSystemNoSend: false,
  });
  const messages = capThreadMessagesForBrief(timeline_7d.messages, now.getTime());
  return {
    window: {
      floor_hours: BRIEF_THREAD_FLOOR_HOURS,
      extension_days: BRIEF_THREAD_EXTENSION_DAYS,
      mode: "72h_floor_7d_extension_capped",
    },
    messages,
    message_count: messages.length,
    char_count: briefThreadMessageCharCount(messages),
    timeline_7d,
  };
}

/** Derive legacy Coach/User line text from structured 72h messages. */
export function recentExactThreadTextFrom72hMessages(messages: RecentExactThread72hMessage[]): string {
  return messages
    .filter((m) => m.role === "coach" || m.role === "user")
    .map((m) => {
      const label = m.role === "coach" ? "Coach" : "User";
      const previewTag = m.delivery_status === "preview" ? " [preview]" : "";
      return `${label}${previewTag}: ${m.body}`;
    })
    .join("\n");
}

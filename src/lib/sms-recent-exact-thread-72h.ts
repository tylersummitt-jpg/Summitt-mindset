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

/** Lean delivery proof for writer-facing recent_exact_thread messages. */
export type RecentExactThreadDeliveryEvidence =
  | "message_sid_present"
  | "outbound_message_sid_present"
  | "status_sent_with_timestamp"
  | "inbound_received"
  | "fallback_last_outbound";

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
  delivery_evidence?: RecentExactThreadDeliveryEvidence;
  is_fallback_context?: boolean;
};

export type RecentExactThread72hResult = {
  messages: RecentExactThread72hMessage[];
  window_hours: typeof RECENT_EXACT_THREAD_WINDOW_HOURS;
  message_count: number;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  oldest_at?: string;
  newest_at?: string;
  /** Populated when thread build records fetch/filter stats (weekly memory packet, etc.). */
  build_telemetry?: BriefThreadBuildTelemetry;
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
  delivery_evidence?: RecentExactThreadDeliveryEvidence;
  is_fallback_context?: boolean;
};

const DEDUPE_WINDOW_MS = 5000;
const NEAR_EXACT_SEND_MS = 120_000;
const ROW_FETCH_LIMIT = 120;
/** Bounded row cap for schema-adaptive select("*") fallback (no timestamp columns in query). */
export const SCHEMA_ADAPTIVE_FALLBACK_LIMIT = 300;

/** Production-verified ORDER BY specs for exact-thread source fetches (newest first). */
export type ExactThreadSourceOrderSpec = {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
};

export const EXACT_THREAD_SOURCE_ORDER_BY: Record<string, ExactThreadSourceOrderSpec[]> = {
  sms_send_events: [{ column: "created_at", ascending: false }],
  sms_weekly_send_events: [{ column: "created_at", ascending: false }],
  sms_inbound_messages: [{ column: "received_at", ascending: false }],
  /**
   * Coach replies: sent_at when present, else job activity time.
   * Chained PostgREST order() calls — sent_at DESC (nulls last), then updated_at, then created_at.
   */
  sms_inbound_coach_jobs: [
    { column: "sent_at", ascending: false, nullsFirst: false },
    { column: "updated_at", ascending: false },
    { column: "created_at", ascending: false },
  ],
};

type SupabaseOrderableQuery<T> = {
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ) => T;
};

function applyExactThreadSourceOrder<T extends SupabaseOrderableQuery<T>>(
  table: string,
  query: T
): T {
  const specs = EXACT_THREAD_SOURCE_ORDER_BY[table];
  if (!specs?.length) return query;
  let next = query;
  for (const spec of specs) {
    next = next.order(spec.column, {
      ascending: spec.ascending,
      ...(spec.nullsFirst !== undefined ? { nullsFirst: spec.nullsFirst } : {}),
    });
  }
  return next;
}

/** Minimal inbound columns when timestamp filters are unavailable. */
const SMS_INBOUND_MESSAGES_CLERK_SELECT =
  "raw_body, message_sid, inserted_at, metadata";

/** Minimal coach-job columns when timestamp filters are unavailable. */
const SMS_INBOUND_COACH_JOBS_CLERK_SELECT =
  "raw_body, reply_body, message_sid, status, outbound_message_sid, metadata";

/** Schema-safe columns for sms_send_events — no optional top-level sent_at/processed_at/updated_at. */
export const SMS_SEND_EVENTS_THREAD_SELECT =
  "sms_body, body, message_body, final_body, body_preview, created_at, metadata, status, message_sid, outbound_message_sid";

/** Schema-safe columns for sms_weekly_send_events — no optional top-level sent_at/processed_at/updated_at. */
export const SMS_WEEKLY_SEND_EVENTS_THREAD_SELECT =
  "body, sms_body, final_body, body_preview, created_at, metadata, status, message_sid, outbound_message_sid";
const PER_MESSAGE_SAFETY_CAP = 8000;
const COACHING_OUTBOUND_KINDS = new Set(["coach", "question", "quote", "nudge", "weekly"]);

export type BriefThreadFilterReason =
  | "timestamp_outside_window"
  | "empty_body"
  | "not_truly_sent"
  | "preview_or_skipped"
  | "compliance_inbound";

export type BriefThreadBuildTelemetry = {
  daily_brief_thread_source_candidate_count: number;
  daily_brief_thread_visible_send_candidate_count: number;
  daily_brief_thread_user_inbound_candidate_count: number;
  daily_brief_thread_weekly_candidate_count: number;
  daily_brief_thread_filtered_out_count: number;
  daily_brief_thread_filtered_out_reason_top: BriefThreadFilterReason | null;
  daily_brief_thread_effective_timestamp_rescue_count: number;
  daily_brief_thread_source_tables_present: string;
  daily_brief_thread_fetch_error_count: number;
  daily_brief_thread_fetch_error_sources: string;
  daily_brief_thread_fetch_error_top: string | null;
  daily_brief_thread_schema_fallback_used: boolean;
  daily_brief_thread_schema_fallback_sources: string;
  daily_brief_thread_fallback_used: boolean;
  daily_brief_thread_fallback_source_count: number;
  daily_brief_thread_primary_fetch_strategy: string;
  daily_brief_thread_primary_fetch_succeeded: boolean;
  daily_brief_thread_recovered_source_rows: number;
};

class ThreadBuildStats {
  source_candidate_count = 0;
  visible_send_candidate_count = 0;
  user_inbound_candidate_count = 0;
  weekly_candidate_count = 0;
  filtered_out_count = 0;
  effective_timestamp_rescue_count = 0;
  fetch_error_count = 0;
  fallback_source_count = 0;
  schema_fallback_used = false;
  primary_fetch_strategy = "select_star";
  primary_fetch_succeeded = false;
  private fetch_error_top: string | null = null;
  private filteredReasons = new Map<BriefThreadFilterReason, number>();
  private sourceTables = new Set<string>();
  private fetchErrorSources = new Set<string>();
  private schemaFallbackSources = new Set<string>();

  noteSourceTable(table: string) {
    this.sourceTables.add(table);
  }

  recordFiltered(reason: BriefThreadFilterReason) {
    this.filtered_out_count += 1;
    this.filteredReasons.set(reason, (this.filteredReasons.get(reason) ?? 0) + 1);
  }

  recordFetchError(source: string, compactMessage: string) {
    this.fetch_error_count += 1;
    this.fetchErrorSources.add(source);
    if (!this.fetch_error_top) {
      const code = compactMessage.split(":")[0]?.trim() || "fetch_error";
      this.fetch_error_top = code.slice(0, 80);
    }
  }

  recordFallback() {
    this.fallback_source_count += 1;
  }

  recordSchemaFallback(sourceTable: string) {
    this.schema_fallback_used = true;
    this.schemaFallbackSources.add(sourceTable);
  }

  recordPrimaryFetchSucceeded() {
    this.primary_fetch_succeeded = true;
  }

  toTelemetry(): BriefThreadBuildTelemetry {
    let top: BriefThreadFilterReason | null = null;
    let topN = 0;
    for (const [reason, n] of this.filteredReasons) {
      if (n > topN) {
        top = reason;
        topN = n;
      }
    }
    return {
      daily_brief_thread_source_candidate_count: this.source_candidate_count,
      daily_brief_thread_visible_send_candidate_count: this.visible_send_candidate_count,
      daily_brief_thread_user_inbound_candidate_count: this.user_inbound_candidate_count,
      daily_brief_thread_weekly_candidate_count: this.weekly_candidate_count,
      daily_brief_thread_filtered_out_count: this.filtered_out_count,
      daily_brief_thread_filtered_out_reason_top: top,
      daily_brief_thread_effective_timestamp_rescue_count: this.effective_timestamp_rescue_count,
      daily_brief_thread_source_tables_present: [...this.sourceTables].sort().join("|"),
      daily_brief_thread_fetch_error_count: this.fetch_error_count,
      daily_brief_thread_fetch_error_sources: [...this.fetchErrorSources].sort().join("|"),
      daily_brief_thread_fetch_error_top: this.fetch_error_top,
      daily_brief_thread_schema_fallback_used: this.schema_fallback_used,
      daily_brief_thread_schema_fallback_sources: [...this.schemaFallbackSources].sort().join("|"),
      daily_brief_thread_fallback_used: this.fallback_source_count > 0,
      daily_brief_thread_fallback_source_count: this.fallback_source_count,
      daily_brief_thread_primary_fetch_strategy: this.primary_fetch_strategy,
      daily_brief_thread_primary_fetch_succeeded: this.primary_fetch_succeeded,
      daily_brief_thread_recovered_source_rows: this.source_candidate_count,
    };
  }
}

function compactSupabaseFetchError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err).slice(0, 200);
  const e = err as { message?: string; code?: string };
  return [e.code, e.message].filter(Boolean).join(": ").slice(0, 200);
}

function isUndefinedColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42703") return true;
  if (typeof e.message === "string" && /column .+ does not exist/i.test(e.message)) return true;
  return false;
}

function rowsFromSupabaseData(data: unknown): Record<string, unknown>[] {
  if (data == null) return [];
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [data as Record<string, unknown>];
}

export type SchemaAdaptiveFetchResult = {
  rows: Record<string, unknown>[];
  schema_fallback_used: boolean;
};

export type SchemaAdaptiveFetchAttempt = {
  sourceLabel: string;
  run: () => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Primary notebook fetch: bounded select("*") by clerk_user_id, newest rows first.
 * Timestamp/window filtering happens in TypeScript.
 */
export async function fetchRowsPrimarySelectStar(args: {
  table: string;
  clerkUserId: string;
  stats?: ThreadBuildStats;
  limit?: number;
}): Promise<SchemaAdaptiveFetchResult> {
  const limit = args.limit ?? SCHEMA_ADAPTIVE_FALLBACK_LIMIT;
  const primaryLabel = `${args.table}:select_star_primary`;
  const { data, error } = await applyExactThreadSourceOrder(
    args.table,
    supabaseServer.from(args.table).select("*").eq("clerk_user_id", args.clerkUserId)
  ).limit(limit);

  if (!error) {
    args.stats?.recordPrimaryFetchSucceeded();
    return { rows: rowsFromSupabaseData(data), schema_fallback_used: false };
  }

  const compact = compactSupabaseFetchError(error);
  console.warn(`[recent-exact-thread] primary fetch failed: ${primaryLabel}`, { error: compact });
  args.stats?.recordFetchError(primaryLabel, compact);

  return fetchRowsSchemaAdaptive({
    table: args.table,
    clerkUserId: args.clerkUserId,
    stats: args.stats,
    attempts: [],
    fallbackLimit: limit,
  });
}

export async function fetchMaybeSinglePrimarySelectStar(args: {
  table: string;
  clerkUserId: string;
  stats?: ThreadBuildStats;
}): Promise<Record<string, unknown> | null> {
  const primaryLabel = `${args.table}:select_star_primary`;
  const { data, error } = await supabaseServer
    .from(args.table)
    .select("*")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  if (!error) {
    args.stats?.recordPrimaryFetchSucceeded();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return null;
  }

  const compact = compactSupabaseFetchError(error);
  console.warn(`[recent-exact-thread] primary fetch failed: ${primaryLabel}`, { error: compact });
  args.stats?.recordFetchError(primaryLabel, compact);

  return fetchMaybeSingleSchemaAdaptive({
    table: args.table,
    clerkUserId: args.clerkUserId,
    stats: args.stats,
    attempts: [],
  });
}

/**
 * Try preferred Supabase queries; on undefined-column (42703) errors, fall through to safer
 * attempts and finally select("*") bounded by clerk_user_id only. Timestamp filtering happens in TS.
 */
export async function fetchRowsSchemaAdaptive(args: {
  table: string;
  clerkUserId: string;
  attempts: SchemaAdaptiveFetchAttempt[];
  stats?: ThreadBuildStats;
  fallbackLimit?: number;
}): Promise<SchemaAdaptiveFetchResult> {
  for (const attempt of args.attempts) {
    const { data, error } = await attempt.run();
    if (!error) {
      return { rows: rowsFromSupabaseData(data), schema_fallback_used: false };
    }
    const compact = compactSupabaseFetchError(error);
    console.warn(`[recent-exact-thread] fetch failed: ${attempt.sourceLabel}`, { error: compact });
    args.stats?.recordFetchError(attempt.sourceLabel, compact);
    if (!isUndefinedColumnError(error)) {
      break;
    }
  }

  const fallbackLabel = `${args.table}:*`;
  const limit = args.fallbackLimit ?? SCHEMA_ADAPTIVE_FALLBACK_LIMIT;
  const { data, error } = await applyExactThreadSourceOrder(
    args.table,
    supabaseServer.from(args.table).select("*").eq("clerk_user_id", args.clerkUserId)
  ).limit(limit);

  if (error) {
    const compact = compactSupabaseFetchError(error);
    console.warn(`[recent-exact-thread] fetch failed: ${fallbackLabel}`, { error: compact });
    args.stats?.recordFetchError(fallbackLabel, compact);
    return { rows: [], schema_fallback_used: false };
  }

  args.stats?.recordSchemaFallback(args.table);
  return { rows: rowsFromSupabaseData(data), schema_fallback_used: true };
}

export async function fetchMaybeSingleSchemaAdaptive(args: {
  table: string;
  clerkUserId: string;
  attempts: SchemaAdaptiveFetchAttempt[];
  stats?: ThreadBuildStats;
}): Promise<Record<string, unknown> | null> {
  for (const attempt of args.attempts) {
    const { data, error } = await attempt.run();
    if (!error) {
      return data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    }
    const compact = compactSupabaseFetchError(error);
    console.warn(`[recent-exact-thread] fetch failed: ${attempt.sourceLabel}`, { error: compact });
    args.stats?.recordFetchError(attempt.sourceLabel, compact);
    if (!isUndefinedColumnError(error)) {
      break;
    }
  }

  const fallbackLabel = `${args.table}:*`;
  const { data, error } = await supabaseServer
    .from(args.table)
    .select("*")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  if (error) {
    const compact = compactSupabaseFetchError(error);
    console.warn(`[recent-exact-thread] fetch failed: ${fallbackLabel}`, { error: compact });
    args.stats?.recordFetchError(fallbackLabel, compact);
    return null;
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    args.stats?.recordSchemaFallback(args.table);
    return data as Record<string, unknown>;
  }
  return null;
}

function firstValidTimestampMs(candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === "string") {
      const ts = new Date(c).getTime();
      if (Number.isFinite(ts) && ts > 0) return ts;
    }
  }
  return 0;
}

function mergeUniqueRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const sid = messageSidFromSendEventRow(row);
    const key = sid
      ? `sid:${sid}`
      : `row:${String(row.created_at ?? "")}|${String(row.status ?? "")}|${String(row.sent_at ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

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

function metaPathString(meta: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let cur: unknown = meta;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : "";
}

function firstNonEmptyBody(...candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** Mirror SQL visible body fallback paths for legacy sent rows. */
export function bodyFromSendEventRow(row: Record<string, unknown>): string {
  const top = firstNonEmptyBody(
    typeof row.sms_body === "string" ? row.sms_body : undefined,
    typeof row.body === "string" ? row.body : undefined,
    typeof row.message_body === "string" ? row.message_body : undefined,
    typeof row.final_body === "string" ? row.final_body : undefined,
    typeof row.body_preview === "string" ? row.body_preview : undefined
  );
  if (top) return stripComplianceFooter(top);

  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    const nested = firstNonEmptyBody(
      metaPathString(m, "sms_body"),
      metaPathString(m, "body"),
      metaPathString(m, "final_body"),
      metaPathString(m, "body_preview"),
      metaPathString(m, "north_star_gate.final_body"),
      metaPathString(m, "north_star_gate.original_body"),
      metaPathString(m, "v3_candidate_body"),
      metaPathString(m, "final_voice_gate.final_body"),
      metaPathString(m, "final_voice_gate.final_body_with_suffix"),
      metaPathString(m, "final_voice_gate.final_voice_gate_body"),
      metaPathString(m, "voice_send_decision.body_preview"),
      metaPathString(m, "voice_send_decision.north_star_visible_body"),
      metaPathString(m, "daily_v3_lane.final_body"),
      metaPathString(m, "daily_v3_lane.body"),
      metaPathString(m, "daily_v3_lane.body_preview"),
      metaPathString(m, "v3_brain.final_body"),
      metaPathString(m, "v3_brain.body")
    );
    if (nested) return stripComplianceFooter(nested);
  }
  return "";
}

function messageSidFromSendEventRow(row: Record<string, unknown>): string | null {
  if (typeof row.message_sid === "string" && row.message_sid.trim()) return row.message_sid.trim();
  if (typeof row.outbound_message_sid === "string" && row.outbound_message_sid.trim()) {
    return row.outbound_message_sid.trim();
  }
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.message_sid === "string" && m.message_sid.trim()) return m.message_sid.trim();
  }
  return null;
}

/** Strong status bucket: requires sent_at/processed_at when no Twilio SID. */
const STRONG_STATUS_WITH_TIMESTAMP = new Set(["sent", "delivered", "success"]);

const NON_VISIBLE_SEND_STATUSES = new Set(["dry_run", "preview", "canceled"]);

function sendEventDeliveryTimestampMs(row: Record<string, unknown>): number {
  const meta = sendEventMetadata(row);
  return firstValidTimestampMs([
    row.sent_at,
    row.processed_at,
    meta?.sent_at,
    meta?.processed_at,
  ]);
}

/**
 * Writer-facing / actual-thread coach delivery gate.
 * SID present, OR status sent|delivered|success with sent_at/processed_at.
 * queued / accepted / sending / twilio_send_attempted-only without SID do not qualify.
 */
export function isSendEventStrongDeliveryEvidence(row: Record<string, unknown>): boolean {
  if (isSendEventExplicitlyExcluded(row)) return false;
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (NON_VISIBLE_SEND_STATUSES.has(status)) return false;

  const sid = messageSidFromSendEventRow(row);
  if (sid) {
    return true;
  }

  if (STRONG_STATUS_WITH_TIMESTAMP.has(status) && sendEventDeliveryTimestampMs(row) > 0) {
    return true;
  }

  return false;
}

export function deliveryEvidenceForSendEventRow(
  row: Record<string, unknown>
): RecentExactThreadDeliveryEvidence | null {
  if (!isSendEventStrongDeliveryEvidence(row)) return null;
  if (messageSidFromSendEventRow(row)) return "message_sid_present";
  return "status_sent_with_timestamp";
}

function sendEventMetadata(row: Record<string, unknown>): Record<string, unknown> | null {
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta as Record<string, unknown>;
  return null;
}

function isSendEventExplicitlyExcluded(row: Record<string, unknown>): boolean {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (SKIPPED_SEND_STATUSES.has(status) || status.startsWith("skipped_")) return true;
  if (status === "cancelled") return true;

  const meta = sendEventMetadata(row);
  if (meta) {
    const noSend = firstNonEmptyBody(
      metaPathString(meta, "no_send_reason"),
      metaPathString(meta, "voice_send_decision.no_send_reason"),
      metaPathString(meta, "daily_v3_lane.no_send_reason")
    );
    if (noSend) return true;
    const note = metaPathString(meta, "note");
    if (note === "daily_v3_lane_no_send") return true;
  }
  return false;
}

/** Mirror Q14 weekly visible body fallback paths. */
export function bodyFromWeeklySendEventRow(row: Record<string, unknown>): string {
  const top = firstNonEmptyBody(
    typeof row.body === "string" ? row.body : undefined,
    typeof row.sms_body === "string" ? row.sms_body : undefined,
    typeof row.final_body === "string" ? row.final_body : undefined,
    typeof row.body_preview === "string" ? row.body_preview : undefined
  );
  if (top) return stripComplianceFooter(top);

  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    const nested = firstNonEmptyBody(
      metaPathString(m, "body"),
      metaPathString(m, "sms_body"),
      metaPathString(m, "final_body"),
      metaPathString(m, "body_preview"),
      metaPathString(m, "north_star_gate.final_body"),
      metaPathString(m, "north_star_gate.original_body"),
      metaPathString(m, "v3_candidate_body"),
      metaPathString(m, "final_voice_gate.final_body"),
      metaPathString(m, "final_voice_gate.final_body_with_suffix"),
      metaPathString(m, "final_voice_gate.final_voice_gate_body"),
      metaPathString(m, "voice_send_decision.body_preview"),
      metaPathString(m, "voice_send_decision.north_star_visible_body")
    );
    if (nested) return stripComplianceFooter(nested);
  }
  return "";
}

/**
 * Actual-thread coach delivery classification for exact SMS thread construction.
 * Strong evidence only: Twilio SID, or status sent|delivered|success with sent_at/processed_at.
 */
export function isSendEventTrulySent(row: Record<string, unknown>): boolean {
  return isSendEventStrongDeliveryEvidence(row);
}

/** Effective send time — Q14 order: sent_at/processed_at first; sent-like rows prefer updated_at over stale created_at. */
export function timestampFromSendEventRow(row: Record<string, unknown>): number {
  const meta = sendEventMetadata(row);
  const primaryTs = firstValidTimestampMs([
    row.sent_at,
    row.processed_at,
    meta?.sent_at,
    meta?.processed_at,
  ]);
  if (primaryTs > 0) return primaryTs;

  if (isSendEventTrulySent(row)) {
    return firstValidTimestampMs([
      row.updated_at,
      row.created_at,
      meta?.updated_at,
      meta?.created_at,
    ]);
  }

  return firstValidTimestampMs([
    row.created_at,
    row.updated_at,
    meta?.created_at,
    meta?.updated_at,
  ]);
}

/** Legacy created_at-only timestamp for rescue telemetry. */
export function createdAtFirstTimestampFromSendEventRow(row: Record<string, unknown>): number {
  const meta = sendEventMetadata(row);
  return firstValidTimestampMs([row.created_at, row.updated_at, meta?.created_at, meta?.updated_at]);
}

export function timestampFromInboundMessageRow(row: Record<string, unknown>): number {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  return firstValidTimestampMs([
    row.received_at,
    row.created_at,
    row.updated_at,
    row.inserted_at,
    meta?.received_at,
    meta?.created_at,
    meta?.updated_at,
  ]);
}

export function timestampFromCoachJobUserRow(row: Record<string, unknown>): number {
  return firstValidTimestampMs([
    row.created_at,
    row.updated_at,
    row.processed_at,
  ]);
}

export function timestampFromCoachJobReplyRow(row: Record<string, unknown>): number {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  return firstValidTimestampMs([
    row.processed_at,
    row.sent_at,
    row.created_at,
    row.updated_at,
    meta?.processed_at,
    meta?.sent_at,
    meta?.created_at,
    meta?.updated_at,
  ]);
}

/** Strong inbound-coach reply gate: outbound SID, or status sent|delivered|success with sent_at. */
export function coachJobReplyStrongDeliveryEvidence(
  row: Record<string, unknown>,
  reply: string
): RecentExactThreadDeliveryEvidence | null {
  if (!reply.trim()) return null;

  if (typeof row.outbound_message_sid === "string" && row.outbound_message_sid.trim()) {
    return "outbound_message_sid_present";
  }

  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (!STRONG_STATUS_WITH_TIMESTAMP.has(status)) return null;

  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const hasTs =
    firstValidTimestampMs([
      row.sent_at,
      row.processed_at,
      meta?.sent_at,
      meta?.processed_at,
    ]) > 0;
  if (!hasTs) return null;
  return "status_sent_with_timestamp";
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
    ...(entry.delivery_evidence ? { delivery_evidence: entry.delivery_evidence } : {}),
    ...(entry.is_fallback_context ? { is_fallback_context: true } : {}),
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
  source_table: string;
  delivery_evidence: RecentExactThreadDeliveryEvidence;
  message_sid?: string;
  is_fallback_context?: true;
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
  /** Writer-facing capped pool — exact DB sources vs last_outbound (telemetry only). */
  exact_source_message_count: number;
  last_outbound_fallback_message_count: number;
  /** Full 7d timeline for coach-body freshness extraction. */
  timeline_7d: RecentExactThread72hResult;
  build_telemetry: BriefThreadBuildTelemetry;
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
  if (m.source_table === "sms_last_outbound_context") return false;
  if (m.is_fallback_context) return false;
  if (m.role === "user") return true;
  if (m.role === "coach") {
    if (m.delivery_status === "preview" || m.delivery_status === "skipped" || m.delivery_status === "cancelled") {
      return false;
    }
    return m.delivery_status === "sent";
  }
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
  const delivery_evidence: RecentExactThreadDeliveryEvidence =
    m.delivery_evidence ??
    (m.role === "user"
      ? "inbound_received"
      : m.message_sid
        ? "message_sid_present"
        : "status_sent_with_timestamp");

  const out: RecentExactThreadBriefMessage = {
    at_local: m.at_local,
    role: m.role === "coach" ? "coach" : "user",
    body: truncateBriefBody(m.body),
    source_table: m.source_table,
    delivery_evidence,
  };
  if (m.message_sid?.trim()) {
    out.message_sid = m.message_sid.trim();
  }
  if (m.is_fallback_context) {
    out.is_fallback_context = true;
  }
  return out;
}

type BriefCapItem = { msg: RecentExactThread72hMessage; ts: number; isFloor: boolean };

export const NOTEBOOK_EXACT_THREAD_SOURCE_TABLES = new Set([
  "sms_send_events",
  "sms_weekly_send_events",
  "sms_inbound_messages",
  "sms_inbound_coach_jobs",
]);

export function countExactAndLastOutboundFromThreadMessages(
  messages: RecentExactThread72hMessage[]
): {
  exact_source_message_count: number;
  last_outbound_fallback_message_count: number;
} {
  const coachUser = messages.filter((m) => m.role === "coach" || m.role === "user");
  return {
    exact_source_message_count: coachUser.filter((m) =>
      NOTEBOOK_EXACT_THREAD_SOURCE_TABLES.has(m.source_table)
    ).length,
    last_outbound_fallback_message_count: coachUser.filter(
      (m) => m.source_table === "sms_last_outbound_context"
    ).length,
  };
}

export type CappedBriefThreadResult = {
  messages: RecentExactThreadBriefMessage[];
  floor_message_count: number;
  extension_message_count: number;
  oldest_at_local: string | null;
  newest_at_local: string | null;
  exact_source_message_count: number;
  last_outbound_fallback_message_count: number;
};

function collectWriterFacingItems(
  messages: RecentExactThread72hMessage[],
  nowMs: number
): BriefCapItem[] {
  const floorMs = nowMs - BRIEF_THREAD_FLOOR_HOURS * 60 * 60 * 1000;
  const items: BriefCapItem[] = [];
  for (const m of messages) {
    if (!isWriterFacingThreadMessage(m)) continue;
    const ts = Date.parse(m.at);
    if (!Number.isFinite(ts)) continue;
    items.push({ msg: m, ts, isFloor: ts >= floorMs });
  }
  items.sort((a, b) => a.ts - b.ts);
  return items;
}

/** Cap writer-facing thread: 72h floor preserved (newest 25), 7d extension until caps. */
export function capThreadMessagesForBriefWithTelemetry(
  messages: RecentExactThread72hMessage[],
  nowMs: number
): CappedBriefThreadResult {
  const items = collectWriterFacingItems(messages, nowMs);
  const floorItems = items.filter((i) => i.isFloor);
  const extensionItems = items.filter((i) => !i.isFloor);

  let chosen: BriefCapItem[] =
    floorItems.length > BRIEF_THREAD_MAX_MESSAGES
      ? floorItems.slice(-BRIEF_THREAD_MAX_MESSAGES)
      : [...floorItems];

  if (chosen.length < BRIEF_THREAD_MAX_MESSAGES && extensionItems.length > 0) {
    const room = BRIEF_THREAD_MAX_MESSAGES - chosen.length;
    const extCandidates = extensionItems.slice(-room);
    chosen = [...extCandidates, ...chosen].sort((a, b) => a.ts - b.ts);
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

  const floorCountInChosen = () => chosen.filter((i) => i.isFloor).length;
  const dropOldestExtension = (): boolean => {
    const idx = chosen.findIndex((i) => !i.isFloor);
    if (idx < 0) return false;
    chosen = [...chosen.slice(0, idx), ...chosen.slice(idx + 1)];
    briefMsgs = chosen.map((i) => toBriefMessage(i.msg));
    return true;
  };

  while (briefThreadMessageCharCount(briefMsgs) > BRIEF_THREAD_MAX_CHARS) {
    if (shrinkLongestCoachBody(floorCountInChosen())) continue;
    if (shrinkLongestCoachBody(0)) continue;
    if (dropOldestExtension()) continue;
    if (chosen.length > 1) {
      chosen = chosen.slice(1);
      briefMsgs = chosen.map((i) => toBriefMessage(i.msg));
      continue;
    }
    break;
  }

  while (chosen.length > BRIEF_THREAD_MAX_MESSAGES) {
    if (dropOldestExtension()) continue;
    if (chosen.length > 1) {
      chosen = chosen.slice(1);
      briefMsgs = chosen.map((i) => toBriefMessage(i.msg));
      continue;
    }
    break;
  }

  const floorMs = nowMs - BRIEF_THREAD_FLOOR_HOURS * 60 * 60 * 1000;
  let floorCount = 0;
  let extensionCount = 0;
  for (const item of chosen) {
    if (item.ts >= floorMs) floorCount += 1;
    else extensionCount += 1;
  }

  const sourceCounts = countExactAndLastOutboundFromThreadMessages(
    chosen.map((i) => i.msg)
  );

  return {
    messages: briefMsgs,
    floor_message_count: floorCount,
    extension_message_count: extensionCount,
    oldest_at_local: chosen[0]?.msg.at_local ?? null,
    newest_at_local: chosen[chosen.length - 1]?.msg.at_local ?? null,
    exact_source_message_count: sourceCounts.exact_source_message_count,
    last_outbound_fallback_message_count: sourceCounts.last_outbound_fallback_message_count,
  };
}

/** Cap writer-facing thread: 72h floor preserved, 7d extension until message/char caps. */
export function capThreadMessagesForBrief(
  messages: RecentExactThread72hMessage[],
  nowMs: number
): RecentExactThreadBriefMessage[] {
  return capThreadMessagesForBriefWithTelemetry(messages, nowMs).messages;
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
  const capped = capThreadMessagesForBriefWithTelemetry(messages, nowMs);
  return {
    daily_brief_thread_floor_message_count: capped.floor_message_count,
    daily_brief_thread_extension_message_count: capped.extension_message_count,
    daily_brief_thread_oldest_at_local: capped.oldest_at_local,
    daily_brief_thread_newest_at_local: capped.newest_at_local,
  };
}

async function buildRecentExactThreadWithWindowMs(
  args: BuildRecentExactThreadArgs & { windowMs: number; stats?: ThreadBuildStats }
): Promise<RecentExactThread72hResult> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - args.windowMs;
  const tz = resolveUserTimezone(args.timezone);
  const includeSystemNoSend = args.includeSystemNoSend === true;
  const stats = args.stats;

  const [
    inboundFetch,
    sendFetch,
    weeklyFetch,
    coachJobFetch,
    lastCtx,
  ] = await Promise.all([
    fetchRowsPrimarySelectStar({
      table: "sms_inbound_messages",
      clerkUserId: args.clerkUserId,
      stats,
      limit: ROW_FETCH_LIMIT,
    }),
    fetchRowsPrimarySelectStar({
      table: "sms_send_events",
      clerkUserId: args.clerkUserId,
      stats,
    }),
    fetchRowsPrimarySelectStar({
      table: "sms_weekly_send_events",
      clerkUserId: args.clerkUserId,
      stats,
    }),
    fetchRowsPrimarySelectStar({
      table: "sms_inbound_coach_jobs",
      clerkUserId: args.clerkUserId,
      stats,
      limit: ROW_FETCH_LIMIT,
    }),
    fetchMaybeSinglePrimarySelectStar({
      table: "sms_last_outbound_context",
      clerkUserId: args.clerkUserId,
      stats,
    }),
  ]);

  const inboundMsgRows = mergeUniqueRows(inboundFetch.rows);
  const sendRows = mergeUniqueRows(sendFetch.rows);
  const weeklyRows = mergeUniqueRows(weeklyFetch.rows);
  const coachJobRows = mergeUniqueRows(coachJobFetch.rows);

  let checkSentEvents = args.preloadedCheckSentEvents;
  if (!checkSentEvents && args.commitmentId) {
    checkSentEvents = await getRecentV2EventsForAi(args.commitmentId);
  }

  const rich: TimelineEntry[] = [];
  const sendBodiesByTime = new Map<number, string>();

  const noteEffectiveTimestampRescue = (row: Record<string, unknown>) => {
    if (!stats) return;
    const effectiveTs = timestampFromSendEventRow(row);
    const createdFirstTs = createdAtFirstTimestampFromSendEventRow(row);
    if (
      createdFirstTs > 0 &&
      createdFirstTs < cutoffMs &&
      Number.isFinite(effectiveTs) &&
      effectiveTs >= cutoffMs
    ) {
      stats.effective_timestamp_rescue_count += 1;
    }
  };

  const pushCoachSendRow = (
    row: Record<string, unknown>,
    source_table: "sms_send_events" | "sms_weekly_send_events",
    message_kind: string
  ) => {
    if (stats) {
      stats.source_candidate_count += 1;
      stats.noteSourceTable(source_table);
    }
    noteEffectiveTimestampRescue(row);

    const ts = timestampFromSendEventRow(row);
    if (!Number.isFinite(ts) || ts < cutoffMs) {
      stats?.recordFiltered("timestamp_outside_window");
      return;
    }

    const bodyRaw =
      source_table === "sms_weekly_send_events"
        ? bodyFromWeeklySendEventRow(row)
        : bodyFromSendEventRow(row);
    if (!bodyRaw) {
      stats?.recordFiltered("empty_body");
      return;
    }

    const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
    const trulySent = isSendEventStrongDeliveryEvidence(row);
    const deliveryEvidence = deliveryEvidenceForSendEventRow(row);

    if (!trulySent || !deliveryEvidence) {
      if (stats) {
        stats.recordFiltered(
          status === "preview" || status.startsWith("skipped") || status === "dry_run"
            ? "preview_or_skipped"
            : "not_truly_sent"
        );
      }
      if (includeSystemNoSend && bodyRaw) {
        const { body, body_truncated } = safeBody(bodyRaw);
        rich.push({
          t: ts,
          role: "system_no_send",
          body,
          source_table,
          message_kind: status || "skipped",
          message_sid: messageSidFromSendEventRow(row),
          delivery_status: status.startsWith("skipped") ? "skipped" : "cancelled",
          is_exact_body: false,
          body_truncated,
          priority: 10,
        });
      }
      return;
    }

    if (stats) {
      stats.visible_send_candidate_count += 1;
      if (source_table === "sms_weekly_send_events") {
        stats.weekly_candidate_count += 1;
      }
    }

    sendBodiesByTime.set(ts, bodyRaw);
    const { body, body_truncated } = safeBody(stripComplianceFooter(bodyRaw));
    rich.push({
      t: ts,
      role: "coach",
      body,
      source_table,
      message_kind,
      message_sid: messageSidFromSendEventRow(row),
      delivery_status: "sent",
      is_exact_body: true,
      body_truncated,
      priority: source_table === "sms_weekly_send_events" ? 88 : 90,
      delivery_evidence: deliveryEvidence,
    });
  };

  for (const r of sendRows) {
    pushCoachSendRow(r, "sms_send_events", "daily");
  }

  for (const r of weeklyRows) {
    pushCoachSendRow(r, "sms_weekly_send_events", "weekly");
  }

  for (const r of coachJobRows) {
    const row = r as Record<string, unknown>;
    if (stats) {
      stats.source_candidate_count += 1;
      stats.noteSourceTable("sms_inbound_coach_jobs");
    }

    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    if (raw) {
      const ts = timestampFromCoachJobUserRow(row);
      if (!Number.isFinite(ts) || ts < cutoffMs) {
        stats?.recordFiltered("timestamp_outside_window");
      } else if (isComplianceInbound(raw)) {
        stats?.recordFiltered("compliance_inbound");
      } else {
        if (stats) stats.user_inbound_candidate_count += 1;
        const { body, body_truncated } = safeBody(raw);
        rich.push({
          t: ts,
          role: "user",
          body,
          source_table: "sms_inbound_coach_jobs",
          message_kind: null,
          message_sid:
            typeof row.message_sid === "string" && row.message_sid.trim()
              ? row.message_sid.trim()
              : null,
          delivery_status: "sent",
          is_exact_body: true,
          body_truncated,
          priority: 95,
          delivery_evidence: "inbound_received",
        });
      }
    }

    const reply = typeof row.reply_body === "string" ? row.reply_body.trim() : "";
    const replyEvidence = coachJobReplyStrongDeliveryEvidence(row, reply);

    if (reply && replyEvidence) {
      if (stats) {
        stats.source_candidate_count += 1;
        stats.noteSourceTable("sms_inbound_coach_jobs");
      }
      const ts = timestampFromCoachJobReplyRow(row);
      if (!Number.isFinite(ts) || ts < cutoffMs) {
        stats?.recordFiltered("timestamp_outside_window");
      } else {
        if (stats) stats.visible_send_candidate_count += 1;
        const { body, body_truncated } = safeBody(stripComplianceFooter(reply));
        rich.push({
          t: ts,
          role: "coach",
          body,
          source_table: "sms_inbound_coach_jobs",
          message_kind: "coach",
          message_sid:
            (typeof row.outbound_message_sid === "string" ? row.outbound_message_sid.trim() : null) ||
            (typeof row.message_sid === "string" ? row.message_sid.trim() : null),
          delivery_status: "sent",
          is_exact_body: true,
          body_truncated,
          priority: 100,
          delivery_evidence: replyEvidence,
        });
      }
    } else if (reply && stats) {
      stats.recordFiltered("not_truly_sent");
    }
  }

  for (const r of inboundMsgRows) {
    const row = r as Record<string, unknown>;
    if (stats) {
      stats.source_candidate_count += 1;
      stats.noteSourceTable("sms_inbound_messages");
    }
    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    const ts = timestampFromInboundMessageRow(row);
    if (!raw) {
      stats?.recordFiltered("empty_body");
      continue;
    }
    if (!Number.isFinite(ts) || ts < cutoffMs) {
      stats?.recordFiltered("timestamp_outside_window");
      continue;
    }
    if (isComplianceInbound(raw)) {
      stats?.recordFiltered("compliance_inbound");
      continue;
    }
    if (stats) stats.user_inbound_candidate_count += 1;
    const { body, body_truncated } = safeBody(raw);
    rich.push({
      t: ts,
      role: "user",
      body,
      source_table: "sms_inbound_messages",
      message_kind: null,
      message_sid:
        typeof row.message_sid === "string" && row.message_sid.trim()
          ? row.message_sid.trim()
          : null,
      delivery_status: "sent",
      is_exact_body: true,
      body_truncated,
      priority: 50,
      delivery_evidence: "inbound_received",
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

  if (lastCtx) {
    const sentAtRaw =
      (typeof lastCtx.sent_at === "string" && lastCtx.sent_at.trim()) ||
      metaPathString(lastCtx, "sent_at") ||
      (typeof lastCtx.created_at === "string" ? lastCtx.created_at : "");
    const row = lastCtx as {
      sent_at?: string;
      full_body?: string;
      message_kind?: string;
      body?: string;
      sms_body?: string;
    };
    const kind = typeof row.message_kind === "string" ? row.message_kind : "transactional";
    if (COACHING_OUTBOUND_KINDS.has(kind)) {
      stats?.noteSourceTable("sms_last_outbound_context");
      const raw =
        firstNonEmptyBody(
          typeof row.full_body === "string" ? row.full_body : undefined,
          typeof row.body === "string" ? row.body : undefined,
          typeof row.sms_body === "string" ? row.sms_body : undefined
        ) || "";
      const ts = sentAtRaw ? new Date(sentAtRaw).getTime() : 0;
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
          stats?.recordFallback();
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
            delivery_evidence: "fallback_last_outbound",
            is_fallback_context: true,
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
  const stats = new ThreadBuildStats();
  const result = await buildRecentExactThreadWithWindowMs({
    ...args,
    windowMs: RECENT_EXACT_THREAD_WINDOW_MS,
    stats,
  });
  return { ...result, build_telemetry: stats.toTelemetry() };
}

/** 7d fetch + 72h floor / capped extension for DailySmsWritingBriefV1. */
export async function buildRecentExactThreadForBrief(
  args: BuildRecentExactThreadArgs
): Promise<RecentExactThreadForBriefResult> {
  const now = args.now ?? new Date();
  const stats = new ThreadBuildStats();
  const timeline_7d = await buildRecentExactThreadWithWindowMs({
    ...args,
    windowMs: BRIEF_THREAD_EXTENSION_MS,
    includeSystemNoSend: false,
    stats,
  });
  const capped = capThreadMessagesForBriefWithTelemetry(timeline_7d.messages, now.getTime());
  return {
    window: {
      floor_hours: BRIEF_THREAD_FLOOR_HOURS,
      extension_days: BRIEF_THREAD_EXTENSION_DAYS,
      mode: "72h_floor_7d_extension_capped",
    },
    messages: capped.messages,
    message_count: capped.messages.length,
    char_count: briefThreadMessageCharCount(capped.messages),
    exact_source_message_count: capped.exact_source_message_count,
    last_outbound_fallback_message_count: capped.last_outbound_fallback_message_count,
    timeline_7d,
    build_telemetry: stats.toTelemetry(),
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

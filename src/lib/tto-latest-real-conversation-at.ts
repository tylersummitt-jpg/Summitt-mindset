/**
 * Derived clock for the newest delivered member or Coach SMS.
 * Not stored. Unsent drafts, reservations, and exact compliance commands do not count.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  coachJobReplyStrongDeliveryEvidence,
  isSendEventStrongDeliveryEvidence,
} from "@/lib/sms-recent-exact-thread-72h";

const INBOUND_LIMIT = 100;
const SENT_LIMIT = 40;

const EXACT_COMPLIANCE_COMMAND =
  /^(stop|start|unstop|help|info|cancel|end)$/i;

export function isExactComplianceCommandBody(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 16) return false;
  return EXACT_COMPLIANCE_COMMAND.test(trimmed);
}

export function realConversationIsNewerThanAuthority(
  latest: string | null,
  authority: string | null
): boolean {
  if (!latest) return false;
  const latestMs = Date.parse(latest);
  if (!Number.isFinite(latestMs)) return false;
  if (!authority) return true;
  const authorityMs = Date.parse(authority);
  if (!Number.isFinite(authorityMs)) return true;
  return latestMs > authorityMs;
}

export type LatestRealConversationAtResult =
  | { ok: true; at: string | null }
  | { ok: false; error: string };

function laterIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return current;
  if (!current) return new Date(candidateMs).toISOString();
  const currentMs = Date.parse(current);
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) {
    return new Date(candidateMs).toISOString();
  }
  return current;
}

function metadataRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/** Proven send time. Bookkeeping updated_at is not a conversation event. */
function provenSendInstant(row: Record<string, unknown>): string | null {
  if (!isSendEventStrongDeliveryEvidence(row)) return null;
  const meta = metadataRecord(row.metadata);
  const primary = [
    row.sent_at,
    row.processed_at,
    meta?.sent_at,
    meta?.processed_at,
  ];
  for (const value of primary) {
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return new Date(Date.parse(value)).toISOString();
    }
  }
  if (typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))) {
    return new Date(Date.parse(row.created_at)).toISOString();
  }
  return null;
}

function firstIso(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  return null;
}

function coachReplyInstant(row: Record<string, unknown>): string | null {
  const reply = typeof row.reply_body === "string" ? row.reply_body : "";
  if (!coachJobReplyStrongDeliveryEvidence(row, reply)) return null;
  const meta = metadataRecord(row.metadata);
  return firstIso([
    row.sent_at,
    row.processed_at,
    meta?.sent_at,
    meta?.processed_at,
    row.created_at,
  ]);
}

export async function readLatestRealConversationAt(
  clerkUserId: string
): Promise<LatestRealConversationAtResult> {
  const id = clerkUserId.trim();
  if (!id) return { ok: true, at: null };

  const [memberRes, coachRes, dailyRes, weeklyRes] = await Promise.all([
    supabaseServer
      .from("sms_inbound_messages")
      .select("received_at, raw_body")
      .eq("clerk_user_id", id)
      .order("received_at", { ascending: false })
      .limit(INBOUND_LIMIT),
    supabaseServer
      .from("sms_inbound_coach_jobs")
      .select("*")
      .eq("clerk_user_id", id)
      .order("created_at", { ascending: false })
      .limit(SENT_LIMIT),
    supabaseServer
      .from("sms_send_events")
      .select("*")
      .eq("clerk_user_id", id)
      .order("created_at", { ascending: false })
      .limit(SENT_LIMIT),
    supabaseServer
      .from("sms_weekly_send_events")
      .select("*")
      .eq("clerk_user_id", id)
      .order("created_at", { ascending: false })
      .limit(SENT_LIMIT),
  ]);

  const failed = [memberRes.error, coachRes.error, dailyRes.error, weeklyRes.error].find(
    (error) => error != null
  );
  if (failed) {
    return { ok: false, error: failed.message };
  }

  let latest: string | null = null;

  for (const row of memberRes.data ?? []) {
    const record = row as { received_at?: unknown; raw_body?: unknown };
    if (typeof record.received_at !== "string") continue;
    const body = typeof record.raw_body === "string" ? record.raw_body : "";
    if (!body.trim() || isExactComplianceCommandBody(body)) continue;
    latest = laterIso(latest, record.received_at);
  }

  for (const row of coachRes.data ?? []) {
    latest = laterIso(latest, coachReplyInstant(row as Record<string, unknown>));
  }
  for (const row of dailyRes.data ?? []) {
    latest = laterIso(latest, provenSendInstant(row as Record<string, unknown>));
  }
  for (const row of weeklyRes.data ?? []) {
    latest = laterIso(latest, provenSendInstant(row as Record<string, unknown>));
  }

  return { ok: true, at: latest };
}

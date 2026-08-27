/**
 * Shared loader: active v2_durable_user_evidence → source=user_message historical evidence.
 * Wins are loaded separately by historical-win-evidence-load.ts and merged.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  EMPTY_HISTORICAL_EVIDENCE,
  type HistoricalEvidenceChronologyCarrier,
  type HistoricalEvidenceItem,
  type HistoricalEvidenceSlice,
} from "@/lib/historical-evidence";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const DURABLE_USER_EVIDENCE_LOAD_CEILING = 40 as const;
export const DURABLE_USER_EVIDENCE_OLDEST_KEEP = 8 as const;
export const DURABLE_USER_EVIDENCE_NEWEST_KEEP = 32 as const;

export type DurableUserEvidenceRow = {
  id: string;
  occurred_at: string;
  source_message_sid: string;
  exact_user_evidence: string;
  created_at?: string;
};

export function applyDurableUserEvidenceSafetyCeiling<T>(rows: T[]): T[] {
  if (rows.length <= DURABLE_USER_EVIDENCE_LOAD_CEILING) return rows;
  return [
    ...rows.slice(0, DURABLE_USER_EVIDENCE_OLDEST_KEEP),
    ...rows.slice(-DURABLE_USER_EVIDENCE_NEWEST_KEEP),
  ];
}

export function survivingMessageSidSet(
  survivingExactThreadMessageSids: Iterable<string>
): Set<string> {
  const out = new Set<string>();
  for (const raw of survivingExactThreadMessageSids) {
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (sid) out.add(sid);
  }
  return out;
}

export function projectDurableUserEvidenceCarriers(args: {
  rows: DurableUserEvidenceRow[];
  timezone: string;
  survivingExactThreadMessageSids: Iterable<string>;
}): HistoricalEvidenceChronologyCarrier[] {
  const inThread = survivingMessageSidSet(args.survivingExactThreadMessageSids);
  const ceilinged = applyDurableUserEvidenceSafetyCeiling(args.rows);
  const carriers: HistoricalEvidenceChronologyCarrier[] = [];
  for (const row of ceilinged) {
    const sid = row.source_message_sid.trim();
    if (!sid || inThread.has(sid)) continue;
    const excerpt = row.exact_user_evidence;
    if (typeof excerpt !== "string" || excerpt.length === 0) continue;
    const occurred = new Date(row.occurred_at);
    const occurredAtMs = occurred.getTime();
    if (!Number.isFinite(occurredAtMs)) continue;
    const item: HistoricalEvidenceItem = {
      source: "user_message",
      occurred_at: getDateKeyInTimezone(occurred, args.timezone),
      evidence: excerpt,
      user_quote: excerpt,
    };
    carriers.push({ occurred_at_ms: occurredAtMs, id: row.id, item });
  }
  return carriers;
}

export function projectDurableUserEvidenceItems(args: {
  rows: DurableUserEvidenceRow[];
  timezone: string;
  survivingExactThreadMessageSids: Iterable<string>;
}): HistoricalEvidenceSlice {
  return projectDurableUserEvidenceCarriers(args).map((row) => row.item);
}

export async function fetchActiveDurableUserEvidenceRows(
  clerkUserId: string
): Promise<DurableUserEvidenceRow[]> {
  const clerk = clerkUserId.trim();
  if (!clerk) return [];
  try {
    const { data, error } = await supabaseServer
      .from("v2_durable_user_evidence")
      .select("id, occurred_at, source_message_sid, exact_user_evidence, created_at")
      .eq("clerk_user_id", clerk)
      .eq("status", "active")
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      console.warn("[durable-user-evidence-load-failed]", {
        clerk_user_id: clerk,
        error: error.message.slice(0, 160),
      });
      return [];
    }
    if (!Array.isArray(data)) return [];
    const rows: DurableUserEvidenceRow[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      if (typeof r.occurred_at !== "string") continue;
      if (typeof r.source_message_sid !== "string") continue;
      if (typeof r.exact_user_evidence !== "string") continue;
      rows.push({
        id: r.id,
        occurred_at: r.occurred_at,
        source_message_sid: r.source_message_sid,
        exact_user_evidence: r.exact_user_evidence,
        created_at: typeof r.created_at === "string" ? r.created_at : undefined,
      });
    }
    return rows;
  } catch (err) {
    console.warn("[durable-user-evidence-load-failed]", {
      clerk_user_id: clerk,
      error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
    return [];
  }
}

export async function loadHistoricalEvidenceFromDurableUserEvidence(args: {
  clerkUserId: string;
  timezone: string;
  survivingExactThreadMessageSids: Iterable<string>;
}): Promise<HistoricalEvidenceSlice> {
  const rows = await fetchActiveDurableUserEvidenceRows(args.clerkUserId);
  if (rows.length === 0) return EMPTY_HISTORICAL_EVIDENCE;
  return projectDurableUserEvidenceItems({
    rows,
    timezone: args.timezone,
    survivingExactThreadMessageSids: args.survivingExactThreadMessageSids,
  });
}

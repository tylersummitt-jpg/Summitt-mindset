/**
 * CAS claim for v2_inbound_media_job Slice B1 download.
 * pending_download → normalizing (in-progress pipeline; B1 does not normalize pixels).
 *
 * Opportunistic recovery (after() kick only — no cron):
 * - pending_download
 * - failed + due next_retry_at + attempt_count < cap
 * - stale normalizing + null temp (abandoned mid-download)
 *
 * B1-complete (normalizing + temp_storage_path) is never selected — B2 handoff.
 */

import { supabaseServer } from "@/lib/supabase-server";

/** Matches processInboundMediaJobB1 retry cap. */
export const INBOUND_MEDIA_B1_MAX_ATTEMPTS = 5;

/**
 * Normalizing + null temp older than this is treated as abandoned mid-B1.
 * Conservative: downloads should finish far sooner.
 */
export const INBOUND_MEDIA_B1_STALE_NORMALIZING_MS = 15 * 60 * 1000;

export type InboundMediaJobRow = {
  id: string;
  message_sid: string;
  media_ordinal: number;
  clerk_user_id: string;
  twilio_media_sid: string | null;
  declared_content_type: string | null;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
  temp_storage_path: string | null;
  normalized_storage_path: string | null;
  attached_win_id: string | null;
  resolution: string | null;
  classifier_target: string | null;
  followup_idempotency_key: string | null;
  expires_at: string | null;
  tombstoned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboundMediaJobActionableLite = {
  id: string;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  temp_storage_path: string | null;
  resolution: string | null;
  tombstoned_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isInboundMediaJobTombstonedOrRemoved(row: {
  status: string;
  resolution: string | null;
  tombstoned_at: string | null;
}): boolean {
  if (row.status === "tombstoned") return true;
  if (row.resolution === "removed") return true;
  if (typeof row.tombstoned_at === "string" && row.tombstoned_at.trim()) return true;
  return false;
}

export function isInboundMediaJobB1Complete(row: {
  status: string;
  temp_storage_path: string | null;
}): boolean {
  return row.status === "normalizing" && !!row.temp_storage_path?.trim();
}

export function isStaleNormalizingWithoutTemp(
  row: {
    status: string;
    temp_storage_path: string | null;
    updated_at: string;
  },
  now: Date,
  staleMs: number = INBOUND_MEDIA_B1_STALE_NORMALIZING_MS
): boolean {
  if (row.status !== "normalizing") return false;
  if (row.temp_storage_path != null && String(row.temp_storage_path).trim() !== "") {
    return false;
  }
  const updated = new Date(row.updated_at).getTime();
  if (!Number.isFinite(updated)) return false;
  return updated <= now.getTime() - staleMs;
}

/**
 * Whether a row is eligible for B1 discovery (list) under recovery law.
 */
export function isInboundMediaJobActionableForB1Download(
  row: InboundMediaJobActionableLite,
  now: Date,
  opts?: { maxAttempts?: number; staleMs?: number }
): boolean {
  const maxAttempts = opts?.maxAttempts ?? INBOUND_MEDIA_B1_MAX_ATTEMPTS;
  const staleMs = opts?.staleMs ?? INBOUND_MEDIA_B1_STALE_NORMALIZING_MS;

  if (isInboundMediaJobTombstonedOrRemoved(row)) return false;
  if (row.status === "expired") return false;
  if (isInboundMediaJobB1Complete(row)) return false;
  if (row.attempt_count >= maxAttempts) return false;

  if (row.status === "pending_download") return true;

  if (row.status === "failed") {
    if (row.next_retry_at == null) return false;
    const due = new Date(row.next_retry_at).getTime();
    if (!Number.isFinite(due)) return false;
    return due <= now.getTime();
  }

  if (isStaleNormalizingWithoutTemp(row, now, staleMs)) return true;

  return false;
}

function actionableSortKey(row: InboundMediaJobActionableLite): string {
  if (row.status === "pending_download") return row.created_at || "";
  if (row.status === "failed") return row.next_retry_at || row.updated_at || "";
  if (row.status === "normalizing") return row.updated_at || "";
  return row.created_at || row.updated_at || "";
}

/**
 * Deterministic merge: oldest actionable work first, stable by id, deduped, capped.
 */
export function pickActionableInboundMediaJobIds(
  rows: InboundMediaJobActionableLite[],
  limit: number,
  now: Date,
  opts?: { maxAttempts?: number; staleMs?: number }
): string[] {
  const n = Math.max(0, Math.min(limit, 5));
  const actionable = rows.filter((r) =>
    isInboundMediaJobActionableForB1Download(r, now, opts)
  );
  actionable.sort((a, b) => {
    const ka = actionableSortKey(a);
    const kb = actionableSortKey(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of actionable) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row.id);
    if (out.length >= n) break;
  }
  return out;
}

function mapJobRow(raw: Record<string, unknown>): InboundMediaJobRow {
  return {
    id: String(raw.id),
    message_sid: String(raw.message_sid),
    media_ordinal: Number(raw.media_ordinal),
    clerk_user_id: String(raw.clerk_user_id),
    twilio_media_sid:
      typeof raw.twilio_media_sid === "string" ? raw.twilio_media_sid : null,
    declared_content_type:
      typeof raw.declared_content_type === "string" ? raw.declared_content_type : null,
    status: String(raw.status),
    attempt_count: Number(raw.attempt_count ?? 0),
    next_retry_at: typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
    last_error_code: typeof raw.last_error_code === "string" ? raw.last_error_code : null,
    temp_storage_path:
      typeof raw.temp_storage_path === "string" ? raw.temp_storage_path : null,
    normalized_storage_path:
      typeof raw.normalized_storage_path === "string" ? raw.normalized_storage_path : null,
    attached_win_id: typeof raw.attached_win_id === "string" ? raw.attached_win_id : null,
    resolution: typeof raw.resolution === "string" ? raw.resolution : null,
    classifier_target:
      typeof raw.classifier_target === "string" ? raw.classifier_target : null,
    followup_idempotency_key:
      typeof raw.followup_idempotency_key === "string"
        ? raw.followup_idempotency_key
        : null,
    expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null,
    tombstoned_at: typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

/**
 * CAS: abandoned normalizing (null temp, stale updated_at) → failed + due-now.
 * Does NOT increment attempt_count (next claim does that once).
 */
async function recoverStaleNormalizingToFailedDue(
  row: InboundMediaJobRow,
  nowIso: string
): Promise<InboundMediaJobRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: "failed",
      next_retry_at: nowIso,
      last_error_code: "stale_normalizing_abandoned",
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("status", "normalizing")
    .eq("attempt_count", row.attempt_count)
    .eq("updated_at", row.updated_at)
    .is("temp_storage_path", null)
    .select("*")
    .maybeSingle();

  if (error || !data) return null;
  return mapJobRow(data as Record<string, unknown>);
}

/**
 * Atomically claim a pending_download, due failed, or recovered-stale job into normalizing.
 * Increments attempt_count exactly once per successful claim.
 */
export async function claimInboundMediaJobForDownload(
  jobId: string,
  opts?: { now?: Date; includeFailedDue?: boolean }
): Promise<InboundMediaJobRow | null> {
  const id = jobId.trim();
  if (!id) return null;
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();

  const { data: existing, error: loadErr } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadErr || !existing) return null;
  let row = mapJobRow(existing as Record<string, unknown>);

  if (isInboundMediaJobTombstonedOrRemoved(row)) return null;
  if (row.status === "expired") return null;
  if (isInboundMediaJobB1Complete(row)) return null;
  if (row.attempt_count >= INBOUND_MEDIA_B1_MAX_ATTEMPTS) return null;

  // Stale mid-B1 crash: CAS to failed+due, then fall through to normal claim (one attempt++).
  if (isStaleNormalizingWithoutTemp(row, now)) {
    const recovered = await recoverStaleNormalizingToFailedDue(row, nowIso);
    if (!recovered) return null;
    row = recovered;
  }

  const failedDue =
    opts?.includeFailedDue !== false &&
    row.status === "failed" &&
    row.next_retry_at != null &&
    new Date(row.next_retry_at).getTime() <= now.getTime() &&
    row.attempt_count < INBOUND_MEDIA_B1_MAX_ATTEMPTS;

  if (row.status !== "pending_download" && !failedDue) return null;

  const nextAttempt = row.attempt_count + 1;

  const { data: claimed, error: claimErr } = await supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: "normalizing",
      attempt_count: nextAttempt,
      last_error_code: null,
      next_retry_at: null,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", row.status)
    .eq("attempt_count", row.attempt_count)
    .select("*")
    .maybeSingle();

  if (claimErr || !claimed) return null;
  return mapJobRow(claimed as Record<string, unknown>);
}

function mapListLite(raw: Record<string, unknown>): InboundMediaJobActionableLite {
  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? ""),
    attempt_count: Number(raw.attempt_count ?? 0),
    next_retry_at: typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
    temp_storage_path:
      typeof raw.temp_storage_path === "string" ? raw.temp_storage_path : null,
    resolution: typeof raw.resolution === "string" ? raw.resolution : null,
    tombstoned_at: typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

function mapListRows(data: unknown[] | null): InboundMediaJobActionableLite[] {
  if (!data) return [];
  return data.map((raw) => mapListLite(raw as Record<string, unknown>));
}

/**
 * Tiny opportunistic discovery for after() kick.
 * pending_download + due failed + stale normalizing (null temp).
 * Never returns B1-complete (normalizing + temp).
 */
export async function listInboundMediaJobsForDownloadClaim(
  limit: number,
  opts?: { now?: Date }
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, 5));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(
    now.getTime() - INBOUND_MEDIA_B1_STALE_NORMALIZING_MS
  ).toISOString();

  const selectCols =
    "id,status,attempt_count,next_retry_at,temp_storage_path,resolution,tombstoned_at,created_at,updated_at";

  const pendingQ = supabaseServer
    .from("v2_inbound_media_job")
    .select(selectCols)
    .eq("status", "pending_download")
    .is("tombstoned_at", null)
    .order("created_at", { ascending: true })
    .limit(n);

  const failedQ = supabaseServer
    .from("v2_inbound_media_job")
    .select(selectCols)
    .eq("status", "failed")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", INBOUND_MEDIA_B1_MAX_ATTEMPTS)
    .is("tombstoned_at", null)
    .order("next_retry_at", { ascending: true })
    .limit(n);

  const staleQ = supabaseServer
    .from("v2_inbound_media_job")
    .select(selectCols)
    .eq("status", "normalizing")
    .is("temp_storage_path", null)
    .lt("updated_at", staleBeforeIso)
    .lt("attempt_count", INBOUND_MEDIA_B1_MAX_ATTEMPTS)
    .is("tombstoned_at", null)
    .order("updated_at", { ascending: true })
    .limit(n);

  const [pendingRes, failedRes, staleRes] = await Promise.all([
    pendingQ,
    failedQ,
    staleQ,
  ]);

  const merged = [
    ...mapListRows(pendingRes.data as unknown[] | null),
    ...mapListRows(failedRes.data as unknown[] | null),
    ...mapListRows(staleRes.data as unknown[] | null),
  ];

  return pickActionableInboundMediaJobIds(merged, n, now);
}

export async function loadInboundMediaJobById(
  jobId: string
): Promise<InboundMediaJobRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("*")
    .eq("id", jobId.trim())
    .maybeSingle();
  if (error || !data) return null;
  return mapJobRow(data as Record<string, unknown>);
}

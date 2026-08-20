/**
 * Slice C1 — correlate BODY+PHOTO awaiting_attach jobs to semantic Wins.
 * Does not create canonical media, call the finalizer, send SMS, or infer photo meaning.
 *
 * Multi-image product lock (C1 v1): if the same clerk + MessageSid has 2+
 * inbound media job rows, never ATTACH_ELIGIBLE. Wait while a sibling is still
 * in B1/B2 ingestion; otherwise terminalize ambiguous_media. History is not
 * forgotten when a sibling later expires/tombstones/fails/skips.
 *
 * In-flight (unresolved ingestion/normalization) sibling:
 * pending_download, normalizing (any temp), failed (any temp, including B1 retry).
 *
 * ATTACH_ELIGIBLE is advisory only — not authorization to write canonical media.
 * A future C2 must revalidate: active Win cardinality, media-job cardinality,
 * expiry, deletion, tombstone, and existing media / web priority.
 *
 * Irreversible terminal kinds (ambiguous_wins / ambiguous_media /
 * web_priority_blocked / other_mms_occupied) are confirmed by a kind-specific
 * validator immediately before CAS. Validators never chain into a different
 * terminal kind; mismatch is awaiting_attach error_retry.
 */

import "server-only";

import { after } from "next/server";
import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";

export const INBOUND_MEDIA_C1_WAIT_RETRY_MS = 60_000;
export const INBOUND_MEDIA_PIPELINE_C1_LIMIT = 1;
/** Cardinality probe: 1 vs 2+. A2 allows up to 10; we never need more than 2. */
export const INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT = 2;
/** Persist/B2 SID trigger evaluates at most one job. */
export const INBOUND_MEDIA_C1_SID_JOB_EVAL_LIMIT = 1;

export type InboundMmsC1DecisionKind =
  | "waiting_for_win"
  | "waiting_for_sibling_media"
  | "attach_eligible"
  | "ambiguous_wins"
  | "ambiguous_media"
  | "web_priority_blocked"
  | "other_mms_occupied"
  | "same_mms_replay"
  | "expired"
  | "tombstoned"
  | "deletion_blocked"
  | "stale_ownership"
  | "not_c1_ready"
  | "provenance_clerk_mismatch"
  | "error_retry";

export type InboundMmsC1WinLite = {
  id: string;
  clerk_user_id: string;
  source_message_sid: string | null;
  source_type: string;
  status: string;
  hidden_at: string | null;
};

export type InboundMmsC1MediaLite = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  source_type: string;
  source_message_sid: string | null;
  source_media_ordinal: number | null;
};

export type InboundMmsC1SiblingLite = {
  id: string;
  status: string;
  temp_storage_path: string | null;
  normalized_storage_path: string | null;
  resolution: string | null;
  attached_win_id: string | null;
  tombstoned_at: string | null;
  expires_at: string | null;
};

/**
 * ATTACH_ELIGIBLE is ephemeral/advisory. It must not be cached as authorization.
 * C2 (not this slice) must revalidate before any canonical attach.
 */
export type InboundMmsC1Decision =
  | {
      kind: "attach_eligible";
      jobId: string;
      clerkUserId: string;
      messageSid: string;
      mediaOrdinal: number;
      winId: string;
      normalizedMasterPath: string;
    }
  | { kind: "same_mms_replay"; jobId: string; winId: string; mediaId: string }
  | { kind: "waiting_for_win"; jobId: string }
  | { kind: "waiting_for_sibling_media"; jobId: string }
  | { kind: "ambiguous_wins"; jobId: string }
  | { kind: "ambiguous_media"; jobId: string }
  | { kind: "web_priority_blocked"; jobId: string; winId: string }
  | { kind: "other_mms_occupied"; jobId: string; winId: string }
  | { kind: "expired"; jobId: string }
  | { kind: "tombstoned"; jobId: string }
  | { kind: "deletion_blocked"; jobId: string; errorCode: string }
  | { kind: "stale_ownership"; jobId: string }
  | { kind: "not_c1_ready"; jobId: string }
  | { kind: "provenance_clerk_mismatch"; jobId: string }
  | { kind: "error_retry"; jobId: string; errorCode: string };

export type CorrelateInboundMmsC1Deps = {
  now?: Date;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
};

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function isInboundMediaJobC1ExpiresAtMalformed(row: {
  expires_at?: string | null;
}): boolean {
  if (row.expires_at == null) return false;
  const trimmed = String(row.expires_at).trim();
  if (!trimmed) return false;
  const t = new Date(trimmed).getTime();
  return !Number.isFinite(t);
}

export function isInboundMediaJobC1Ready(
  row: {
    status: string;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution: string | null;
    attached_win_id: string | null;
    tombstoned_at: string | null;
    expires_at?: string | null;
  },
  now: Date
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(row)) return false;
  if (row.status !== "awaiting_attach") return false;
  if (hasNonEmptyText(row.temp_storage_path)) return false;
  if (!hasNonEmptyText(row.normalized_storage_path)) return false;
  if (row.resolution != null) return false;
  if (hasNonEmptyText(row.attached_win_id)) return false;
  if (hasNonEmptyText(row.tombstoned_at)) return false;
  if (isInboundMediaJobC1ExpiresAtMalformed(row)) return false;
  if (isInboundMediaJobExpiresAtPast(row, now)) return false;
  return true;
}

/** C retry/wait shape must never be B1 (failed+null temp) or B2 (normalizing/failed+temp). */
export function isInboundMediaJobC1RetryShape(row: {
  status: string;
  temp_storage_path: string | null;
  normalized_storage_path: string | null;
  resolution: string | null;
  attached_win_id: string | null;
}): boolean {
  return (
    row.status === "awaiting_attach" &&
    !hasNonEmptyText(row.temp_storage_path) &&
    hasNonEmptyText(row.normalized_storage_path) &&
    row.resolution == null &&
    !hasNonEmptyText(row.attached_win_id)
  );
}

function nextRetryDue(nextRetryAt: string | null, now: Date): boolean {
  if (nextRetryAt == null) return false;
  const due = new Date(nextRetryAt).getTime();
  if (!Number.isFinite(due)) return false;
  return due <= now.getTime();
}

export function isInboundMediaJobC1Due(
  row: {
    status: string;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution: string | null;
    attached_win_id: string | null;
    tombstoned_at: string | null;
    expires_at?: string | null;
    next_retry_at: string | null;
  },
  now: Date
): boolean {
  if (!isInboundMediaJobC1Ready(row, now)) return false;
  return nextRetryDue(row.next_retry_at, now);
}

/**
 * Opportunistic C1 candidate, including already-expired awaiting_attach rows
 * so they drain (CAS expire) instead of clogging the due window.
 */
export function isInboundMediaJobC1OpportunisticCandidate(
  row: {
    status: string;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution: string | null;
    attached_win_id: string | null;
    tombstoned_at: string | null;
    next_retry_at: string | null;
  },
  now: Date
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(row)) return false;
  if (row.status !== "awaiting_attach") return false;
  if (hasNonEmptyText(row.temp_storage_path)) return false;
  if (!hasNonEmptyText(row.normalized_storage_path)) return false;
  if (row.resolution != null) return false;
  if (hasNonEmptyText(row.attached_win_id)) return false;
  return nextRetryDue(row.next_retry_at, now);
}

function isUnresolvedIngestionSibling(row: InboundMmsC1SiblingLite): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(row)) return false;
  if (row.status === "pending_download") return true;
  if (row.status === "normalizing") return true;
  if (row.status === "failed") return true;
  return false;
}

export function sameSidMediaJobCardinalityIsMulti(
  siblings: Array<{ id: string }>,
  jobId: string
): boolean {
  if (siblings.some((s) => s.id !== jobId)) return true;
  return siblings.length >= 2;
}

export function filterActiveCorrelatedWins(
  rows: InboundMmsC1WinLite[],
  args: { clerkUserId: string; messageSid: string }
): InboundMmsC1WinLite[] {
  const clerk = args.clerkUserId.trim();
  const sid = args.messageSid.trim();
  return rows.filter((w) => {
    if (w.clerk_user_id !== clerk) return false;
    if ((w.source_message_sid ?? "").trim() !== sid) return false;
    if (w.source_type !== "sms_inbound") return false;
    if (w.status !== "active") return false;
    if (hasNonEmptyText(w.hidden_at)) return false;
    return true;
  });
}

function isSameMmsProvenance(
  media: InboundMmsC1MediaLite,
  job: InboundMediaJobRow
): boolean {
  return (
    media.source_type === "inbound_mms" &&
    (media.source_message_sid ?? "").trim() === job.message_sid.trim() &&
    media.source_media_ordinal === job.media_ordinal
  );
}

function occupancyFromMedia(args: {
  job: InboundMediaJobRow;
  winId: string;
  clerk: string;
  media: InboundMmsC1MediaLite | null;
  provenanceMedia: InboundMmsC1MediaLite | null;
}): InboundMmsC1Decision {
  const { job, winId, clerk, media, provenanceMedia } = args;
  const jobId = job.id;

  if (provenanceMedia) {
    if (provenanceMedia.clerk_user_id !== clerk) {
      return { kind: "provenance_clerk_mismatch", jobId };
    }
    if (isSameMmsProvenance(provenanceMedia, job) && provenanceMedia.win_id === winId) {
      if (provenanceMedia.id !== job.id) {
        return {
          kind: "error_retry",
          jobId,
          errorCode: "same_mms_media_id_mismatch",
        };
      }
      return {
        kind: "same_mms_replay",
        jobId,
        winId,
        mediaId: provenanceMedia.id,
      };
    }
  }

  if (!media) {
    return {
      kind: "attach_eligible",
      jobId,
      clerkUserId: clerk,
      messageSid: job.message_sid.trim(),
      mediaOrdinal: job.media_ordinal,
      winId,
      normalizedMasterPath: job.normalized_storage_path!.trim(),
    };
  }
  if (media.clerk_user_id !== clerk) {
    return { kind: "error_retry", jobId, errorCode: "media_lookup_failed" };
  }
  if (media.source_type === "web_upload") {
    return { kind: "web_priority_blocked", jobId, winId };
  }
  if (media.source_type === "inbound_mms") {
    if (isSameMmsProvenance(media, job)) {
      if (media.id !== job.id) {
        return {
          kind: "error_retry",
          jobId,
          errorCode: "same_mms_media_id_mismatch",
        };
      }
      return { kind: "same_mms_replay", jobId, winId, mediaId: media.id };
    }
    return { kind: "other_mms_occupied", jobId, winId };
  }
  return { kind: "other_mms_occupied", jobId, winId };
}

export function evaluateAwaitingInboundMmsAttachment(args: {
  job: InboundMediaJobRow;
  now: Date;
  deletion: "clear" | "unresolved" | "lookup_failed";
  wins: InboundMmsC1WinLite[];
  mediaByWinId: Map<string, InboundMmsC1MediaLite | null>;
  provenanceMedia: InboundMmsC1MediaLite | null;
  siblings: InboundMmsC1SiblingLite[];
}): InboundMmsC1Decision {
  const job = args.job;
  const jobId = job.id;

  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { kind: "tombstoned", jobId };
  }
  if (isInboundMediaJobC1ExpiresAtMalformed(job)) {
    return { kind: "error_retry", jobId, errorCode: "invalid_expires_at" };
  }
  if (isInboundMediaJobExpiresAtPast(job, args.now)) {
    return { kind: "expired", jobId };
  }
  if (!isInboundMediaJobC1Ready(job, args.now)) {
    return { kind: "not_c1_ready", jobId };
  }
  if (args.deletion === "unresolved") {
    return {
      kind: "deletion_blocked",
      jobId,
      errorCode: "account_deletion_unresolved",
    };
  }
  if (args.deletion === "lookup_failed") {
    return {
      kind: "deletion_blocked",
      jobId,
      errorCode: "account_deletion_lookup_failed",
    };
  }

  const clerk = job.clerk_user_id.trim();
  const sid = job.message_sid.trim();
  if (!clerk || !sid) {
    return { kind: "not_c1_ready", jobId };
  }

  const inFlight = args.siblings.some(
    (s) => s.id !== job.id && isUnresolvedIngestionSibling(s)
  );
  if (inFlight) {
    return { kind: "waiting_for_sibling_media", jobId };
  }

  if (sameSidMediaJobCardinalityIsMulti(args.siblings, job.id)) {
    return { kind: "ambiguous_media", jobId };
  }

  const wins = filterActiveCorrelatedWins(args.wins, {
    clerkUserId: clerk,
    messageSid: sid,
  });
  if (wins.length === 0) {
    return { kind: "waiting_for_win", jobId };
  }
  if (wins.length >= 2) {
    return { kind: "ambiguous_wins", jobId };
  }

  const win = wins[0]!;
  const media = args.mediaByWinId.get(win.id) ?? null;
  return occupancyFromMedia({
    job,
    winId: win.id,
    clerk,
    media,
    provenanceMedia: args.provenanceMedia,
  });
}

type AwaitingAttachSnapshot = {
  id: string;
  clerk_user_id: string;
  status: string;
  normalized_storage_path: string;
  updated_at: string;
};

async function casAwaitingAttachJob(args: {
  snapshot: AwaitingAttachSnapshot;
  patch: Record<string, unknown>;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .update(args.patch)
    .eq("id", args.snapshot.id)
    .eq("clerk_user_id", args.snapshot.clerk_user_id)
    .eq("status", "awaiting_attach")
    .eq("normalized_storage_path", args.snapshot.normalized_storage_path)
    .eq("updated_at", args.snapshot.updated_at)
    .is("temp_storage_path", null)
    .is("resolution", null)
    .is("attached_win_id", null)
    .is("tombstoned_at", null)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

function snapshotFromJob(job: InboundMediaJobRow): AwaitingAttachSnapshot | null {
  const norm = job.normalized_storage_path?.trim() ?? "";
  if (!norm) return null;
  return {
    id: job.id,
    clerk_user_id: job.clerk_user_id,
    status: job.status,
    normalized_storage_path: norm,
    updated_at: job.updated_at,
  };
}

function waitPatch(now: Date, errorCode: string): Record<string, unknown> {
  return {
    last_error_code: errorCode,
    next_retry_at: new Date(now.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString(),
    updated_at: now.toISOString(),
  };
}

function expirePatch(now: Date, errorCode: string): Record<string, unknown> {
  return {
    status: "expired",
    resolution: "expired",
    attached_win_id: null,
    next_retry_at: null,
    last_error_code: errorCode,
    updated_at: now.toISOString(),
  };
}

/**
 * Apply wait/terminal/replay.
 * ATTACH_ELIGIBLE does not write canonical media or attached_* fields.
 * Until C2 exists it DOES arm next_retry_at so the row stays visible to retries.
 */
export async function applyInboundMmsC1Decision(args: {
  job: InboundMediaJobRow;
  decision: InboundMmsC1Decision;
  now: Date;
}): Promise<InboundMmsC1Decision> {
  const snap = snapshotFromJob(args.job);
  const now = args.now;
  const nowIso = now.toISOString();
  const d = args.decision;

  if (d.kind === "tombstoned" || d.kind === "not_c1_ready") {
    return d;
  }
  if (d.kind === "stale_ownership") return d;
  if (!snap || args.job.status !== "awaiting_attach") {
    return { kind: "stale_ownership", jobId: args.job.id };
  }

  let patch: Record<string, unknown> | null = null;
  if (d.kind === "attach_eligible") {
    patch = waitPatch(now, "attach_eligible");
  } else if (d.kind === "waiting_for_win") {
    patch = waitPatch(now, "waiting_for_win");
  } else if (d.kind === "waiting_for_sibling_media") {
    patch = waitPatch(now, "waiting_for_sibling_media");
  } else if (d.kind === "error_retry") {
    patch = waitPatch(now, d.errorCode);
  } else if (d.kind === "provenance_clerk_mismatch") {
    patch = waitPatch(now, "provenance_clerk_mismatch");
  } else if (d.kind === "expired") {
    patch = expirePatch(now, "expired");
  } else if (d.kind === "deletion_blocked") {
    patch = expirePatch(now, d.errorCode);
  } else if (d.kind === "ambiguous_wins") {
    patch = {
      status: "skipped_conflict",
      resolution: "ambiguous",
      attached_win_id: null,
      next_retry_at: null,
      last_error_code: "ambiguous_wins",
      updated_at: nowIso,
    };
  } else if (d.kind === "ambiguous_media") {
    patch = {
      status: "skipped_conflict",
      resolution: "ambiguous",
      attached_win_id: null,
      next_retry_at: null,
      last_error_code: "ambiguous_media",
      updated_at: nowIso,
    };
  } else if (d.kind === "web_priority_blocked") {
    patch = {
      status: "skipped_conflict",
      resolution: "user_priority_blocked",
      attached_win_id: null,
      next_retry_at: null,
      last_error_code: "user_priority_blocked",
      updated_at: nowIso,
    };
  } else if (d.kind === "other_mms_occupied") {
    patch = {
      status: "skipped_conflict",
      resolution: null,
      attached_win_id: null,
      next_retry_at: null,
      last_error_code: "other_mms_occupied",
      updated_at: nowIso,
    };
  } else if (d.kind === "same_mms_replay") {
    patch = {
      status: "attached",
      resolution: "attached",
      attached_win_id: d.winId,
      next_retry_at: null,
      last_error_code: null,
      updated_at: nowIso,
    };
  }

  if (!patch) return d;
  const won = await casAwaitingAttachJob({ snapshot: snap, patch });
  if (!won) return { kind: "stale_ownership", jobId: args.job.id };
  return d;
}

function mapWinLite(raw: Record<string, unknown>): InboundMmsC1WinLite {
  return {
    id: String(raw.id ?? ""),
    clerk_user_id: String(raw.clerk_user_id ?? ""),
    source_message_sid:
      typeof raw.source_message_sid === "string" ? raw.source_message_sid : null,
    source_type: String(raw.source_type ?? ""),
    status: String(raw.status ?? ""),
    hidden_at: typeof raw.hidden_at === "string" ? raw.hidden_at : null,
  };
}

function mapMediaLite(raw: Record<string, unknown>): InboundMmsC1MediaLite {
  return {
    id: String(raw.id ?? ""),
    win_id: String(raw.win_id ?? ""),
    clerk_user_id: String(raw.clerk_user_id ?? ""),
    source_type: String(raw.source_type ?? ""),
    source_message_sid:
      typeof raw.source_message_sid === "string" ? raw.source_message_sid : null,
    source_media_ordinal:
      raw.source_media_ordinal == null ? null : Number(raw.source_media_ordinal),
  };
}

function mapSiblingLite(raw: Record<string, unknown>): InboundMmsC1SiblingLite {
  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? ""),
    temp_storage_path:
      typeof raw.temp_storage_path === "string" ? raw.temp_storage_path : null,
    normalized_storage_path:
      typeof raw.normalized_storage_path === "string"
        ? raw.normalized_storage_path
        : null,
    resolution: typeof raw.resolution === "string" ? raw.resolution : null,
    attached_win_id:
      typeof raw.attached_win_id === "string" ? raw.attached_win_id : null,
    tombstoned_at: typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
    expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null,
  };
}

async function loadCorrelatedWins(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<InboundMmsC1WinLite[]> {
  // Collection on purpose. Live production has 2 active Wins for one MessageSid.
  // Do not collapse matching Wins to one row.
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id,clerk_user_id,source_message_sid,source_type,status,hidden_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("source_message_sid", args.messageSid)
    .eq("source_type", "sms_inbound");
  if (error) {
    throw new Error("correlation_query_failed");
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => mapWinLite(raw as Record<string, unknown>));
}

async function loadMediaForWin(args: {
  winId: string;
  clerkUserId: string;
}): Promise<InboundMmsC1MediaLite | null> {
  const { data, error } = await supabaseServer
    .from("v2_win_media")
    .select(
      "id,win_id,clerk_user_id,source_type,source_message_sid,source_media_ordinal"
    )
    .eq("win_id", args.winId)
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();
  if (error) {
    throw new Error("media_lookup_failed");
  }
  if (!data) return null;
  return mapMediaLite(data as Record<string, unknown>);
}

async function loadProvenanceMedia(args: {
  messageSid: string;
  mediaOrdinal: number;
}): Promise<InboundMmsC1MediaLite | null> {
  const { data, error } = await supabaseServer
    .from("v2_win_media")
    .select(
      "id,win_id,clerk_user_id,source_type,source_message_sid,source_media_ordinal"
    )
    .eq("source_message_sid", args.messageSid)
    .eq("source_media_ordinal", args.mediaOrdinal)
    .maybeSingle();
  if (error) {
    throw new Error("media_lookup_failed");
  }
  if (!data) return null;
  return mapMediaLite(data as Record<string, unknown>);
}

const SIBLING_SELECT =
  "id,status,temp_storage_path,normalized_storage_path,resolution,attached_win_id,tombstoned_at,expires_at";

async function loadSameSidJobSample(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<InboundMmsC1SiblingLite[]> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(SIBLING_SELECT)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("message_sid", args.messageSid)
    .limit(INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT);
  if (error) {
    throw new Error("correlation_query_failed");
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => mapSiblingLite(raw as Record<string, unknown>));
}

async function loadInFlightSiblingSample(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<InboundMmsC1SiblingLite[]> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(SIBLING_SELECT)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("message_sid", args.messageSid)
    .in("status", ["pending_download", "normalizing", "failed"])
    .limit(1);
  if (error) {
    throw new Error("correlation_query_failed");
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => mapSiblingLite(raw as Record<string, unknown>));
}

async function loadSiblingsForC1(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<InboundMmsC1SiblingLite[]> {
  const [sample, inFlight] = await Promise.all([
    loadSameSidJobSample(args),
    loadInFlightSiblingSample(args),
  ]);
  const byId = new Map<string, InboundMmsC1SiblingLite>();
  for (const row of [...sample, ...inFlight]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function loadC1ExternalFacts(job: InboundMediaJobRow): Promise<{
  wins: InboundMmsC1WinLite[];
  siblings: InboundMmsC1SiblingLite[];
  provenanceMedia: InboundMmsC1MediaLite | null;
  mediaByWinId: Map<string, InboundMmsC1MediaLite | null>;
}> {
  const siblings = await loadSiblingsForC1({
    clerkUserId: job.clerk_user_id,
    messageSid: job.message_sid,
  });
  const wins = await loadCorrelatedWins({
    clerkUserId: job.clerk_user_id,
    messageSid: job.message_sid,
  });
  const provenanceMedia = await loadProvenanceMedia({
    messageSid: job.message_sid,
    mediaOrdinal: job.media_ordinal,
  });
  const mediaByWinId = new Map<string, InboundMmsC1MediaLite | null>();
  const active = filterActiveCorrelatedWins(wins, {
    clerkUserId: job.clerk_user_id,
    messageSid: job.message_sid,
  });
  if (active.length === 1) {
    const winId = active[0]!.id;
    mediaByWinId.set(
      winId,
      await loadMediaForWin({ winId, clerkUserId: job.clerk_user_id })
    );
  }
  return { wins, siblings, provenanceMedia, mediaByWinId };
}

function needsExternalRevalidation(kind: InboundMmsC1Decision["kind"]): boolean {
  return (
    kind === "ambiguous_wins" ||
    kind === "ambiguous_media" ||
    kind === "web_priority_blocked" ||
    kind === "other_mms_occupied" ||
    kind === "same_mms_replay"
  );
}

async function revalidateReplayBeforeAttach(args: {
  job: InboundMediaJobRow;
  decision: Extract<InboundMmsC1Decision, { kind: "same_mms_replay" }>;
  now: Date;
  deletionCheck: (clerkUserId: string) => Promise<boolean>;
}): Promise<InboundMmsC1Decision> {
  const { job, decision, now } = args;
  if (isInboundMediaJobC1ExpiresAtMalformed(job)) {
    return { kind: "error_retry", jobId: job.id, errorCode: "invalid_expires_at" };
  }
  if (isInboundMediaJobExpiresAtPast(job, now)) {
    return { kind: "expired", jobId: job.id };
  }
  try {
    if (await args.deletionCheck(job.clerk_user_id)) {
      return {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode: "account_deletion_unresolved",
      };
    }
  } catch {
    return {
      kind: "deletion_blocked",
      jobId: job.id,
      errorCode: "account_deletion_lookup_failed",
    };
  }

  const again = await loadProvenanceMedia({
    messageSid: job.message_sid,
    mediaOrdinal: job.media_ordinal,
  });
  if (
    !again ||
    again.id !== job.id ||
    again.id !== decision.mediaId ||
    again.win_id !== decision.winId ||
    again.clerk_user_id !== job.clerk_user_id ||
    again.source_type !== "inbound_mms" ||
    (again.source_message_sid ?? "").trim() !== job.message_sid.trim() ||
    again.source_media_ordinal !== job.media_ordinal
  ) {
    const mismatchId = again && again.id !== job.id;
    return {
      kind: "error_retry",
      jobId: job.id,
      errorCode: mismatchId ? "same_mms_media_id_mismatch" : "media_lookup_failed",
    };
  }

  const wins = await loadCorrelatedWins({
    clerkUserId: job.clerk_user_id,
    messageSid: job.message_sid,
  });
  const active = filterActiveCorrelatedWins(wins, {
    clerkUserId: job.clerk_user_id,
    messageSid: job.message_sid,
  });
  if (!active.some((w) => w.id === decision.winId) || active.length !== 1) {
    return { kind: "error_retry", jobId: job.id, errorCode: "media_lookup_failed" };
  }
  return decision;
}

type TerminalFactCheck = { ok: true } | { ok: false; errorCode: string };

function staleTerminalRetry(jobId: string, errorCode: string): InboundMmsC1Decision {
  return { kind: "error_retry", jobId, errorCode };
}

/**
 * Kind-specific terminal validators. Once entered, a validator may only:
 *   A. confirm the exact kind still true → apply that kind, or
 *   B. stale/error → awaiting_attach error_retry.
 * It must not emit a different terminal kind (no chaining).
 *
 * Residual last-read → CAS window remains: the fact can change after this
 * read and before casAwaitingAttachJob. Accepted for C1 v1 (no cross-table
 * lock). These validators run immediately before apply/CAS with no other
 * await in between except the CAS itself.
 */
async function validateAmbiguousWinsStillTrue(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<TerminalFactCheck> {
  try {
    const wins = await loadCorrelatedWins(args);
    const active = filterActiveCorrelatedWins(wins, args);
    if (active.length >= 2) return { ok: true };
    return { ok: false, errorCode: "stale_ambiguous_wins" };
  } catch {
    return { ok: false, errorCode: "correlation_query_failed" };
  }
}

async function validateAmbiguousMediaStillTrue(args: {
  clerkUserId: string;
  messageSid: string;
  jobId: string;
}): Promise<TerminalFactCheck> {
  try {
    const sample = await loadSameSidJobSample(args);
    if (sameSidMediaJobCardinalityIsMulti(sample, args.jobId)) return { ok: true };
    return { ok: false, errorCode: "stale_ambiguous_media" };
  } catch {
    return { ok: false, errorCode: "correlation_query_failed" };
  }
}

async function validateWebPriorityStillTrue(args: {
  clerkUserId: string;
  winId: string;
}): Promise<TerminalFactCheck> {
  try {
    const media = await loadMediaForWin(args);
    if (media && media.source_type === "web_upload") return { ok: true };
    return { ok: false, errorCode: "stale_web_priority" };
  } catch {
    return { ok: false, errorCode: "media_lookup_failed" };
  }
}

async function validateOtherMmsStillTrue(args: {
  job: InboundMediaJobRow;
  winId: string;
}): Promise<TerminalFactCheck> {
  try {
    const media = await loadMediaForWin({
      winId: args.winId,
      clerkUserId: args.job.clerk_user_id,
    });
    if (
      media &&
      media.source_type === "inbound_mms" &&
      !isSameMmsProvenance(media, args.job)
    ) {
      return { ok: true };
    }
    return { ok: false, errorCode: "stale_other_mms_occupied" };
  } catch {
    return { ok: false, errorCode: "media_lookup_failed" };
  }
}

async function confirmTerminalKindImmediatelyBeforeCas(
  job: InboundMediaJobRow,
  decision: InboundMmsC1Decision
): Promise<InboundMmsC1Decision> {
  if (decision.kind === "ambiguous_wins") {
    const check = await validateAmbiguousWinsStillTrue({
      clerkUserId: job.clerk_user_id,
      messageSid: job.message_sid,
    });
    return check.ok ? decision : staleTerminalRetry(job.id, check.errorCode);
  }
  if (decision.kind === "ambiguous_media") {
    const check = await validateAmbiguousMediaStillTrue({
      clerkUserId: job.clerk_user_id,
      messageSid: job.message_sid,
      jobId: job.id,
    });
    return check.ok ? decision : staleTerminalRetry(job.id, check.errorCode);
  }
  if (decision.kind === "web_priority_blocked") {
    const check = await validateWebPriorityStillTrue({
      clerkUserId: job.clerk_user_id,
      winId: decision.winId,
    });
    return check.ok ? decision : staleTerminalRetry(job.id, check.errorCode);
  }
  if (decision.kind === "other_mms_occupied") {
    const check = await validateOtherMmsStillTrue({
      job,
      winId: decision.winId,
    });
    return check.ok ? decision : staleTerminalRetry(job.id, check.errorCode);
  }
  return decision;
}

export async function evaluateAndApplyInboundMmsC1Job(
  job: InboundMediaJobRow,
  deps: CorrelateInboundMmsC1Deps = {}
): Promise<InboundMmsC1Decision> {
  const now = deps.now ?? new Date();
  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { kind: "tombstoned", jobId: job.id };
  }
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;

  let deletion: "clear" | "unresolved" | "lookup_failed" = "clear";
  try {
    if (await deletionCheck(job.clerk_user_id)) {
      deletion = "unresolved";
    }
  } catch {
    deletion = "lookup_failed";
  }

  if (deletion !== "clear") {
    return applyInboundMmsC1Decision({
      job,
      decision: {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode:
          deletion === "unresolved"
            ? "account_deletion_unresolved"
            : "account_deletion_lookup_failed",
      },
      now,
    });
  }

  let facts: Awaited<ReturnType<typeof loadC1ExternalFacts>>;
  try {
    facts = await loadC1ExternalFacts(job);
  } catch (e) {
    const code =
      e instanceof Error && e.message === "media_lookup_failed"
        ? "media_lookup_failed"
        : "correlation_query_failed";
    return applyInboundMmsC1Decision({
      job,
      decision: { kind: "error_retry", jobId: job.id, errorCode: code },
      now,
    });
  }

  let decision = evaluateAwaitingInboundMmsAttachment({
    job,
    now,
    deletion,
    ...facts,
  });

  if (needsExternalRevalidation(decision.kind)) {
    let deletionAgain: "clear" | "unresolved" | "lookup_failed" = "clear";
    try {
      if (await deletionCheck(job.clerk_user_id)) {
        deletionAgain = "unresolved";
      }
    } catch {
      deletionAgain = "lookup_failed";
    }
    if (deletionAgain !== "clear") {
      return applyInboundMmsC1Decision({
        job,
        decision: {
          kind: "deletion_blocked",
          jobId: job.id,
          errorCode:
            deletionAgain === "unresolved"
              ? "account_deletion_unresolved"
              : "account_deletion_lookup_failed",
        },
        now,
      });
    }

    try {
      facts = await loadC1ExternalFacts(job);
      decision = evaluateAwaitingInboundMmsAttachment({
        job,
        now,
        deletion: "clear",
        ...facts,
      });
    } catch (e) {
      const code =
        e instanceof Error && e.message === "media_lookup_failed"
          ? "media_lookup_failed"
          : "correlation_query_failed";
      return applyInboundMmsC1Decision({
        job,
        decision: { kind: "error_retry", jobId: job.id, errorCode: code },
        now,
      });
    }
  }

  if (decision.kind === "same_mms_replay") {
    try {
      decision = await revalidateReplayBeforeAttach({
        job,
        decision,
        now,
        deletionCheck,
      });
    } catch {
      decision = {
        kind: "error_retry",
        jobId: job.id,
        errorCode: "media_lookup_failed",
      };
    }
  } else if (
    decision.kind === "ambiguous_wins" ||
    decision.kind === "ambiguous_media" ||
    decision.kind === "web_priority_blocked" ||
    decision.kind === "other_mms_occupied"
  ) {
    // Next await is this kind-specific check, then apply's CAS. No chaining.
    try {
      decision = await confirmTerminalKindImmediatelyBeforeCas(job, decision);
    } catch {
      decision = {
        kind: "error_retry",
        jobId: job.id,
        errorCode: "correlation_query_failed",
      };
    }
  }

  return applyInboundMmsC1Decision({ job, decision, now });
}

export async function tryCorrelateInboundMmsC1Job(
  jobId: string,
  deps: CorrelateInboundMmsC1Deps = {}
): Promise<InboundMmsC1Decision | null> {
  const id = jobId.trim();
  if (!id) return null;
  const job = await loadInboundMediaJobById(id);
  if (!job) return null;
  return evaluateAndApplyInboundMmsC1Job(job, deps);
}

export async function tryCorrelateAwaitingInboundMmsForMessageSid(
  args: { clerkUserId: string; messageSid: string },
  deps: CorrelateInboundMmsC1Deps = {}
): Promise<InboundMmsC1Decision[]> {
  const clerkUserId = args.clerkUserId.trim();
  const messageSid = args.messageSid.trim();
  if (!clerkUserId || !messageSid) return [];
  const now = deps.now ?? new Date();

  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("message_sid", messageSid)
    .eq("status", "awaiting_attach")
    .limit(INBOUND_MEDIA_C1_SID_JOB_EVAL_LIMIT);
  if (error) {
    console.error("[victory-media/mms-c1] sid_list_failed", {
      error_code: "correlation_query_failed",
    });
    return [];
  }
  if (!data || data.length === 0) return [];

  const raw = data[0] as Record<string, unknown>;
  const job = await loadInboundMediaJobById(String(raw.id ?? ""));
  if (!job) return [];
  const processable =
    isInboundMediaJobC1Ready(job, now) ||
    isInboundMediaJobExpiresAtPast(job, now) ||
    isInboundMediaJobC1ExpiresAtMalformed(job);
  if (!processable && !isInboundMediaJobTombstonedOrRemoved(job)) {
    return [];
  }
  return [await evaluateAndApplyInboundMmsC1Job(job, { ...deps, now })];
}

export async function listInboundMediaJobsForC1(
  limit: number,
  opts?: { now?: Date }
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, INBOUND_MEDIA_PIPELINE_C1_LIMIT));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,status,attempt_count,next_retry_at,temp_storage_path,normalized_storage_path,resolution,attached_win_id,tombstoned_at,expires_at,created_at,updated_at"
    )
    .eq("status", "awaiting_attach")
    .is("temp_storage_path", null)
    .is("resolution", null)
    .is("attached_win_id", null)
    .is("tombstoned_at", null)
    .not("normalized_storage_path", "is", null)
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", nowIso)
    .order("next_retry_at", { ascending: true })
    .limit(n);
  if (error || !data) return [];
  const ids: string[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const row = {
      id: String(raw.id ?? ""),
      status: String(raw.status ?? ""),
      temp_storage_path:
        typeof raw.temp_storage_path === "string" ? raw.temp_storage_path : null,
      normalized_storage_path:
        typeof raw.normalized_storage_path === "string"
          ? raw.normalized_storage_path
          : null,
      resolution: typeof raw.resolution === "string" ? raw.resolution : null,
      attached_win_id:
        typeof raw.attached_win_id === "string" ? raw.attached_win_id : null,
      tombstoned_at:
        typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
      next_retry_at: typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
    };
    if (!row.id || !isInboundMediaJobC1OpportunisticCandidate(row, now)) continue;
    ids.push(row.id);
    if (ids.length >= n) break;
  }
  return ids;
}

/**
 * Held by Next `after()` / waitUntil. Must not delay Coach SMS (caller returns first).
 */
export function scheduleCorrelateAwaitingInboundMmsAfterWinPersist(args: {
  clerkUserId: string;
  messageSid: string;
}): void {
  const clerkUserId = args.clerkUserId.trim();
  const messageSid = args.messageSid.trim();
  if (!clerkUserId || !messageSid) return;
  try {
    after(async () => {
      try {
        await tryCorrelateAwaitingInboundMmsForMessageSid({
          clerkUserId,
          messageSid,
        });
      } catch (e) {
        console.error("[victory-media/mms-c1] persist_hook_failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } catch (e) {
    console.warn("[victory-media/mms-c1] after_unavailable", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export function scheduleC1IfWinsDurable(args: {
  persisted: number;
  conflicts: number;
  clerkUserId: string;
  messageSid: string;
}): void {
  if (args.persisted <= 0 && args.conflicts <= 0) return;
  scheduleCorrelateAwaitingInboundMmsAfterWinPersist({
    clerkUserId: args.clerkUserId,
    messageSid: args.messageSid,
  });
}

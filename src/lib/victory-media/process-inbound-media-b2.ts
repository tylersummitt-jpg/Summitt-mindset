/**
 * Slice B2 — normalize private mms-temp → write mms-norm master/card →
 * Body+photo awaiting_attach / image-only pending_semantics.
 * Does not attach Wins, persist canonical media rows, call vision, or send SMS.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import {
  claimInboundMediaJobForNormalize,
  claimInboundMediaJobForNormalizeAfterSuccessfulB1,
  INBOUND_MEDIA_B2_EXPIRES_MS,
  INBOUND_MEDIA_B2_MAX_ATTEMPTS,
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import { VICTORY_MEDIA_BUCKET, VICTORY_MEDIA_MAX_UPLOAD_BYTES } from "@/lib/victory-media/constants";
import type {
  NormalizeVictoryImageDeps,
  NormalizeVictoryImageInput,
  NormalizeVictoryImageResult,
  VictoryMediaNormalizeErrorCode,
} from "@/lib/victory-media/image-types";
import { normalizeVictoryImage } from "@/lib/victory-media/normalize-victory-image";
import {
  INBOUND_MEDIA_C1_WAIT_RETRY_MS,
  tryCorrelateInboundMmsC1Job,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import { INBOUND_MEDIA_D2A_SEMANTIC_DUE } from "@/lib/victory-media/inbound-mms-d2a-codes";
import {
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
  victoryMediaMmsTempPath,
} from "@/lib/victory-media/storage-paths";

export type InboundMediaB2Mode = "body_photo" | "image_only";

export type ProcessInboundMediaB2Result =
  | {
      ok: true;
      jobId: string;
      mode: InboundMediaB2Mode;
      status: "awaiting_attach" | "pending_semantics";
      normalizedStoragePath: string;
    }
  | { ok: false; jobId: string; reason: string; terminal: boolean };

export type ProcessInboundMediaB2Deps = {
  normalize?: (
    input: NormalizeVictoryImageInput,
    deps?: NormalizeVictoryImageDeps
  ) => Promise<NormalizeVictoryImageResult>;
  normalizeDeps?: NormalizeVictoryImageDeps;
  uploadNorm?: (args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    contentType: string;
  }) => Promise<void>;
  removeObjects?: (args: { bucket: string; paths: string[] }) => Promise<void>;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  lookupBodyMode?: (args: {
    messageSid: string;
    clerkUserId: string;
  }) => Promise<InboundMediaB2Mode>;
  now?: Date;
};

/** Snapshot of the B2 attempt this worker claimed. Failure/expiry CAS must match it. */
type OwnedB2Attempt = {
  id: string;
  status: string;
  temp_storage_path: string;
  attempt_count: number;
  updated_at: string;
};

const TERMINAL_NORMALIZE_CODES: ReadonlySet<VictoryMediaNormalizeErrorCode> = new Set([
  "too_large_bytes",
  "too_many_pixels",
  "unsupported_format",
  "dangerous_svg",
  "animated_gif_not_supported",
  "corrupt_image",
  "heic_requires_storage_source",
  "unexpected_transform_format",
]);

function computeNextRetryIso(attempt: number): string {
  const sec = Math.min(600, 30 * Math.max(1, attempt));
  return new Date(Date.now() + sec * 1000).toISOString();
}

function ownedAttemptFromRow(job: InboundMediaJobRow): OwnedB2Attempt | null {
  const temp = job.temp_storage_path?.trim() ?? "";
  if (!temp) return null;
  return {
    id: job.id,
    status: job.status,
    temp_storage_path: temp,
    attempt_count: job.attempt_count,
    updated_at: job.updated_at,
  };
}

/**
 * Narrow owned-attempt CAS. Never updates by id only.
 * If another worker/state transition changed the row after our snapshot, this loses.
 */
async function casOwnedB2Attempt(args: {
  claimed: OwnedB2Attempt;
  patch: Record<string, unknown>;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .update(args.patch)
    .eq("id", args.claimed.id)
    .eq("status", args.claimed.status)
    .eq("temp_storage_path", args.claimed.temp_storage_path)
    .eq("attempt_count", args.claimed.attempt_count)
    .eq("updated_at", args.claimed.updated_at)
    .is("resolution", null)
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

async function markFailedOwned(args: {
  claimed: OwnedB2Attempt;
  errorCode: string;
  terminal: boolean;
}): Promise<boolean> {
  const nowIso = new Date().toISOString();
  return casOwnedB2Attempt({
    claimed: args.claimed,
    patch: {
      status: "failed",
      last_error_code: args.errorCode,
      updated_at: nowIso,
      next_retry_at: args.terminal ? null : computeNextRetryIso(args.claimed.attempt_count),
    },
  });
}

async function markExpiredOwned(args: {
  claimed: OwnedB2Attempt;
  errorCode: string;
}): Promise<boolean> {
  const nowIso = new Date().toISOString();
  return casOwnedB2Attempt({
    claimed: args.claimed,
    patch: {
      status: "expired",
      resolution: "expired",
      last_error_code: args.errorCode,
      next_retry_at: null,
      updated_at: nowIso,
    },
  });
}

async function defaultUploadNorm(args: {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
}): Promise<void> {
  const { error } = await supabaseServer.storage.from(args.bucket).upload(args.path, args.bytes, {
    contentType: args.contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`norm_upload_failed:${error.message}`);
  }
}

async function defaultRemoveObjects(args: { bucket: string; paths: string[] }): Promise<void> {
  if (args.paths.length === 0) return;
  const { error } = await supabaseServer.storage.from(args.bucket).remove(args.paths);
  if (error) {
    console.warn("[victory-media/mms-b2] storage_cleanup_failed", {
      path_suffixes: args.paths.map((p) => p.split("/").slice(-3).join("/")),
      message: error.message,
    });
  }
}

async function defaultLookupBodyMode(args: {
  messageSid: string;
  clerkUserId: string;
}): Promise<InboundMediaB2Mode> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("id")
    .eq("message_sid", args.messageSid)
    .eq("clerk_user_id", args.clerkUserId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`mode_lookup_failed:${error.message}`);
  }
  return data?.id ? "body_photo" : "image_only";
}

function logBase(job: InboundMediaJobRow) {
  return {
    job_id: job.id,
    message_sid: job.message_sid,
    media_ordinal: job.media_ordinal,
    attempt: job.attempt_count,
  };
}

function staleOwnershipResult(jobId: string): ProcessInboundMediaB2Result {
  return { ok: false, jobId, reason: "stale_ownership", terminal: false };
}

async function failOwnedOrStale(args: {
  claimed: OwnedB2Attempt;
  errorCode: string;
  terminal: boolean;
}): Promise<ProcessInboundMediaB2Result> {
  const won = await markFailedOwned(args);
  if (!won) return staleOwnershipResult(args.claimed.id);
  return {
    ok: false,
    jobId: args.claimed.id,
    reason: args.errorCode,
    terminal: args.terminal,
  };
}

/**
 * Process a single inbound media job through B2 (normalize → mms-norm → ready state).
 * Ordinary callers cannot bypass the 5-minute lease.
 */
export async function processInboundMediaJobB2(
  jobId: string,
  deps: ProcessInboundMediaB2Deps = {}
): Promise<ProcessInboundMediaB2Result> {
  return runInboundMediaJobB2(jobId, deps, { afterSuccessfulB1: false });
}

/**
 * Pipeline-only: this invocation just completed B1 for this exact job.
 * Lease bypass is not a generic caller flag and is not request-driven.
 */
export async function processInboundMediaJobB2AfterSuccessfulB1(
  jobId: string,
  deps: ProcessInboundMediaB2Deps = {}
): Promise<ProcessInboundMediaB2Result> {
  return runInboundMediaJobB2(jobId, deps, { afterSuccessfulB1: true });
}

async function runInboundMediaJobB2(
  jobId: string,
  deps: ProcessInboundMediaB2Deps,
  opts: { afterSuccessfulB1: boolean }
): Promise<ProcessInboundMediaB2Result> {
  const now = deps.now ?? new Date();
  const removeObjects = deps.removeObjects ?? defaultRemoveObjects;

  const existing = await loadInboundMediaJobById(jobId);
  if (!existing) {
    return { ok: false, jobId, reason: "claim_failed", terminal: false };
  }
  if (isInboundMediaJobTombstonedOrRemoved(existing)) {
    return { ok: false, jobId, reason: "claim_failed", terminal: false };
  }

  if (isInboundMediaJobExpiresAtPast(existing, now)) {
    return expireAlreadyPast(existing, removeObjects);
  }

  const claimed = opts.afterSuccessfulB1
    ? await claimInboundMediaJobForNormalizeAfterSuccessfulB1(jobId, { now })
    : await claimInboundMediaJobForNormalize(jobId, { now });

  if (!claimed) {
    return { ok: false, jobId, reason: "claim_failed", terminal: false };
  }

  const job = claimed;
  const owned = ownedAttemptFromRow(job);
  if (!owned) {
    return { ok: false, jobId: job.id, reason: "claim_failed", terminal: false };
  }
  const attempt = owned;

  const base = logBase(job);
  console.info("[victory-media/mms-b2] claim", base);

  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;
  const upload = deps.uploadNorm ?? defaultUploadNorm;
  const lookupBodyMode = deps.lookupBodyMode ?? defaultLookupBodyMode;
  const normalizeFn = deps.normalize ?? normalizeVictoryImage;

  const hitCap = job.attempt_count >= INBOUND_MEDIA_B2_MAX_ATTEMPTS;

  let expectedTemp: string;
  let masterPath: string;
  let cardPath: string;
  try {
    expectedTemp = victoryMediaMmsTempPath(job.clerk_user_id, job.id);
    masterPath = victoryMediaMmsNormMasterPath(job.clerk_user_id, job.id);
    cardPath = victoryMediaMmsNormCardPath(job.clerk_user_id, job.id);
  } catch {
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "invalid_temp_path",
      terminal: true,
    });
  }

  const tempPath = attempt.temp_storage_path;
  if (tempPath !== expectedTemp) {
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "invalid_temp_path",
      terminal: true,
    });
  }

  async function expireOwnedIfStillClaimed(
    code: string
  ): Promise<ProcessInboundMediaB2Result> {
    const won = await markExpiredOwned({ claimed: attempt, errorCode: code });
    if (!won) return staleOwnershipResult(job.id);
    await removeObjects({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [tempPath, masterPath, cardPath],
    });
    return { ok: false, jobId: job.id, reason: code, terminal: true };
  }

  try {
    console.info("[victory-media/mms-b2] deletion_guard", base);
    if (await deletionCheck(job.clerk_user_id)) {
      return await expireOwnedIfStillClaimed("account_deletion_unresolved");
    }
  } catch {
    return await expireOwnedIfStillClaimed("account_deletion_lookup_failed");
  }

  const afterClaim = await loadInboundMediaJobById(job.id);
  if (!afterClaim || isInboundMediaJobTombstonedOrRemoved(afterClaim)) {
    await removeObjects({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [tempPath, masterPath, cardPath],
    });
    return { ok: false, jobId: job.id, reason: "tombstoned", terminal: true };
  }

  console.info("[victory-media/mms-b2] normalize", { ...base, stage: "normalize" });
  let normalized: NormalizeVictoryImageResult;
  try {
    normalized = await normalizeFn(
      {
        source: {
          kind: "supabase_object",
          bucket: VICTORY_MEDIA_BUCKET,
          path: tempPath,
        },
        maxIncomingBytes: VICTORY_MEDIA_MAX_UPLOAD_BYTES,
      },
      deps.normalizeDeps
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[victory-media/mms-b2] normalize_threw", {
      ...base,
      stage: "normalize",
      error_code: "normalize_threw",
      message: msg,
    });
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "normalize_threw",
      terminal: hitCap,
    });
  }

  if (!normalized.ok) {
    const terminal = hitCap || TERMINAL_NORMALIZE_CODES.has(normalized.code);
    console.info("[victory-media/mms-b2] normalize_failed", {
      ...base,
      stage: "normalize",
      error_code: normalized.code,
      terminal,
    });
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: normalized.code,
      terminal,
    });
  }

  const afterNorm = await loadInboundMediaJobById(job.id);
  if (!afterNorm || isInboundMediaJobTombstonedOrRemoved(afterNorm)) {
    await removeObjects({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [tempPath, masterPath, cardPath],
    });
    return { ok: false, jobId: job.id, reason: "tombstoned", terminal: true };
  }

  try {
    console.info("[victory-media/mms-b2] master_upload", { ...base, stage: "master_upload" });
    await upload({
      bucket: VICTORY_MEDIA_BUCKET,
      path: masterPath,
      bytes: normalized.master.bytes,
      contentType: "image/jpeg",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[victory-media/mms-b2] master_upload_failed", {
      ...base,
      stage: "master_upload",
      error_code: "master_upload_failed",
      message: msg,
    });
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "master_upload_failed",
      terminal: hitCap,
    });
  }

  try {
    console.info("[victory-media/mms-b2] card_upload", { ...base, stage: "card_upload" });
    await upload({
      bucket: VICTORY_MEDIA_BUCKET,
      path: cardPath,
      bytes: normalized.card.bytes,
      contentType: "image/jpeg",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[victory-media/mms-b2] card_upload_failed", {
      ...base,
      stage: "card_upload",
      error_code: "card_upload_failed",
      message: msg,
    });
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "card_upload_failed",
      terminal: hitCap,
    });
  }

  const beforeTransition = await loadInboundMediaJobById(job.id);
  if (!beforeTransition || isInboundMediaJobTombstonedOrRemoved(beforeTransition)) {
    await removeObjects({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [masterPath, cardPath],
    });
    return { ok: false, jobId: job.id, reason: "tombstoned_race", terminal: true };
  }

  try {
    if (await deletionCheck(job.clerk_user_id)) {
      return await expireOwnedIfStillClaimed("account_deletion_unresolved");
    }
  } catch {
    return await expireOwnedIfStillClaimed("account_deletion_lookup_failed");
  }

  let mode: InboundMediaB2Mode;
  try {
    console.info("[victory-media/mms-b2] mode_lookup", { ...base, stage: "mode_lookup" });
    mode = await lookupBodyMode({
      messageSid: job.message_sid,
      clerkUserId: job.clerk_user_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[victory-media/mms-b2] mode_lookup_failed", {
      ...base,
      stage: "mode_lookup",
      error_code: "mode_lookup_failed",
      message: msg,
    });
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "mode_lookup_failed",
      terminal: hitCap,
    });
  }

  const nextStatus = mode === "body_photo" ? "awaiting_attach" : "pending_semantics";
  const nowIso = now.toISOString();
  const expiresAt =
    beforeTransition.expires_at ??
    new Date(now.getTime() + INBOUND_MEDIA_B2_EXPIRES_MS).toISOString();
  const nextRetryAt =
    nextStatus === "awaiting_attach"
      ? new Date(now.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS).toISOString()
      : nowIso;
  const lastErrorCode =
    nextStatus === "pending_semantics" ? INBOUND_MEDIA_D2A_SEMANTIC_DUE : null;

  console.info("[victory-media/mms-b2] db_transition", {
    ...base,
    stage: "db_transition",
    mode,
    status_to: nextStatus,
    sniffed_format: normalized.source.sniffedFormat,
    used_heic_bridge: normalized.source.usedHeicBridge,
    master_byte_size: normalized.master.byteSize,
    card_byte_size: normalized.card.byteSize,
    master_width: normalized.master.width,
    master_height: normalized.master.height,
    card_width: normalized.card.width,
    card_height: normalized.card.height,
  });

  const { data: updated, error: updErr } = await supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: nextStatus,
      resolution: null,
      normalized_storage_path: masterPath,
      temp_storage_path: null,
      last_error_code: lastErrorCode,
      next_retry_at: nextRetryAt,
      expires_at: expiresAt,
      updated_at: nowIso,
    })
    .eq("id", job.id)
    .eq("status", "normalizing")
    .eq("temp_storage_path", tempPath)
    .eq("attempt_count", job.attempt_count)
    .eq("updated_at", job.updated_at)
    .is("resolution", null)
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .select("id")
    .maybeSingle();

  if (updErr || !updated) {
    const raced = await loadInboundMediaJobById(job.id);
    if (!raced || isInboundMediaJobTombstonedOrRemoved(raced)) {
      await removeObjects({
        bucket: VICTORY_MEDIA_BUCKET,
        paths: [masterPath, cardPath],
      });
      return { ok: false, jobId: job.id, reason: "tombstoned_race", terminal: true };
    }
    if (raced.status === "awaiting_attach" || raced.status === "pending_semantics") {
      return staleOwnershipResult(job.id);
    }
    return failOwnedOrStale({
      claimed: attempt,
      errorCode: "success_update_conflict",
      terminal: false,
    });
  }

  console.info("[victory-media/mms-b2] temp_cleanup", {
    ...base,
    stage: "temp_cleanup",
    mode,
  });
  try {
    await removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths: [tempPath] });
  } catch (e) {
    console.warn("[victory-media/mms-b2] temp_cleanup_failed", {
      ...base,
      stage: "temp_cleanup",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  console.info("[victory-media/mms-b2] success", {
    ...base,
    mode,
    status: nextStatus,
    sniffed_format: normalized.source.sniffedFormat,
    used_heic_bridge: normalized.source.usedHeicBridge,
    master_byte_size: normalized.master.byteSize,
    card_byte_size: normalized.card.byteSize,
  });

  if (nextStatus === "awaiting_attach") {
    try {
      // C1 uses its own evaluation clock — do not pass B2 start `now`.
      await tryCorrelateInboundMmsC1Job(job.id);
    } catch (e) {
      console.error("[victory-media/mms-b2] c1_correlate_failed", {
        ...base,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ok: true,
    jobId: job.id,
    mode,
    status: nextStatus,
    normalizedStoragePath: masterPath,
  };
}

async function expireAlreadyPast(
  existing: InboundMediaJobRow,
  removeObjects: NonNullable<ProcessInboundMediaB2Deps["removeObjects"]>
): Promise<ProcessInboundMediaB2Result> {
  const owned = ownedAttemptFromRow(existing);
  if (!owned) {
    return { ok: false, jobId: existing.id, reason: "expired", terminal: true };
  }

  const won = await markExpiredOwned({ claimed: owned, errorCode: "expired" });
  if (won) {
    let paths: string[] = [owned.temp_storage_path];
    try {
      paths = [
        victoryMediaMmsTempPath(existing.clerk_user_id, existing.id),
        victoryMediaMmsNormMasterPath(existing.clerk_user_id, existing.id),
        victoryMediaMmsNormCardPath(existing.clerk_user_id, existing.id),
      ];
    } catch {
      paths = [owned.temp_storage_path];
    }
    await removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths });
    return { ok: false, jobId: existing.id, reason: "expired", terminal: true };
  }

  const raced = await loadInboundMediaJobById(existing.id);
  if (raced && isInboundMediaJobTombstonedOrRemoved(raced)) {
    return { ok: false, jobId: existing.id, reason: "stale_ownership", terminal: false };
  }
  return staleOwnershipResult(existing.id);
}

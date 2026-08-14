/**
 * Slice B1 — claim → secure Twilio download → private mms-temp upload.
 * Stops before normalization, Win attach, vision APIs, or normalized storage writes.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import {
  claimInboundMediaJobForDownload,
  INBOUND_MEDIA_B1_MAX_ATTEMPTS,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  downloadTwilioMmsMediaBytes,
  listTwilioMessageMediaSids,
  TwilioMmsDownloadError,
  type TwilioMmsDownloadDeps,
} from "@/lib/victory-media/download-twilio-mms-media";
import type { SniffedImageFormat } from "@/lib/victory-media/image-types";
import {
  sniffImageFormat,
  storageMimeForSniffedImageFormat,
} from "@/lib/victory-media/sniff-image-format";
import { victoryMediaMmsTempPath } from "@/lib/victory-media/storage-paths";
import {
  isTwilioMediaSid,
  isTwilioMessageSid,
} from "@/lib/victory-media/twilio-mms-media-url";

/** Re-export retry cap for callers/tests. */
export { INBOUND_MEDIA_B1_MAX_ATTEMPTS };

export type ProcessInboundMediaB1Result =
  | { ok: true; jobId: string; tempStoragePath: string; sniffedFormat: SniffedImageFormat }
  | { ok: false; jobId: string; reason: string; terminal: boolean };

export type ProcessInboundMediaB1Deps = {
  downloadDeps?: TwilioMmsDownloadDeps;
  uploadTemp?: (args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    contentType: string;
  }) => Promise<void>;
  removeTemp?: (args: { bucket: string; path: string }) => Promise<void>;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  now?: Date;
};

function computeNextRetryIso(attempt: number): string {
  // 30s, 60s, 90s, … capped at 10 minutes
  const sec = Math.min(600, 30 * Math.max(1, attempt));
  return new Date(Date.now() + sec * 1000).toISOString();
}

async function defaultUploadTemp(args: {
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
    throw new Error(`temp_upload_failed:${error.message}`);
  }
}

async function defaultRemoveTemp(args: { bucket: string; path: string }): Promise<void> {
  const { error } = await supabaseServer.storage.from(args.bucket).remove([args.path]);
  if (error) {
    console.warn("[victory-media/mms-b1] temp_cleanup_failed", {
      path_suffix: args.path.split("/").slice(-2).join("/"),
      message: error.message,
    });
  }
}

async function markFailed(args: {
  jobId: string;
  attemptCount: number;
  errorCode: string;
  terminal: boolean;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "failed",
    last_error_code: args.errorCode,
    updated_at: nowIso,
    next_retry_at: args.terminal ? null : computeNextRetryIso(args.attemptCount),
  };
  await supabaseServer.from("v2_inbound_media_job").update(patch).eq("id", args.jobId);
}

async function markExpired(jobId: string, errorCode: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: "expired",
      resolution: "expired",
      last_error_code: errorCode,
      next_retry_at: null,
      updated_at: nowIso,
    })
    .eq("id", jobId);
}

async function resolveMediaSid(
  job: InboundMediaJobRow,
  downloadDeps?: TwilioMmsDownloadDeps
): Promise<{ mediaSid: string } | { error: string; terminal: boolean }> {
  if (job.twilio_media_sid && isTwilioMediaSid(job.twilio_media_sid)) {
    return { mediaSid: job.twilio_media_sid.trim() };
  }

  try {
    const list = await listTwilioMessageMediaSids(job.message_sid, {
      fetchFn: downloadDeps?.fetchFn,
      accountSid: downloadDeps?.accountSid,
      authToken: downloadDeps?.authToken,
    });
    if (list.length === 1 && isTwilioMediaSid(list[0]!.sid)) {
      return { mediaSid: list[0]!.sid };
    }
    return { error: "media_sid_unresolved", terminal: true };
  } catch (e) {
    if (e instanceof TwilioMmsDownloadError) {
      return { error: e.code, terminal: !e.retryable };
    }
    return { error: "media_list_failed", terminal: false };
  }
}

/**
 * Process a single inbound media job through B1 (download → mms-temp).
 */
export async function processInboundMediaJobB1(
  jobId: string,
  deps: ProcessInboundMediaB1Deps = {}
): Promise<ProcessInboundMediaB1Result> {
  const claimed = await claimInboundMediaJobForDownload(jobId, {
    now: deps.now,
    includeFailedDue: true,
  });

  if (!claimed) {
    return { ok: false, jobId, reason: "claim_failed", terminal: false };
  }

  const logBase = {
    job_id: claimed.id,
    message_sid: claimed.message_sid,
    media_ordinal: claimed.media_ordinal,
    attempt: claimed.attempt_count,
  };

  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;

  try {
    if (await deletionCheck(claimed.clerk_user_id)) {
      console.info("[victory-media/mms-b1] account_deletion", logBase);
      await markExpired(claimed.id, "account_deletion_unresolved");
      return { ok: false, jobId: claimed.id, reason: "account_deletion_unresolved", terminal: true };
    }
  } catch {
    await markExpired(claimed.id, "account_deletion_lookup_failed");
    return {
      ok: false,
      jobId: claimed.id,
      reason: "account_deletion_lookup_failed",
      terminal: true,
    };
  }

  // Re-check tombstone after claim
  const fresh = await loadInboundMediaJobById(claimed.id);
  if (!fresh || isInboundMediaJobTombstonedOrRemoved(fresh)) {
    return { ok: false, jobId: claimed.id, reason: "tombstoned", terminal: true };
  }

  if (!isTwilioMessageSid(fresh.message_sid)) {
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: "invalid_message_sid",
      terminal: true,
    });
    return { ok: false, jobId: fresh.id, reason: "invalid_message_sid", terminal: true };
  }

  const sidResult = await resolveMediaSid(fresh, deps.downloadDeps);
  if ("error" in sidResult) {
    const terminal =
      sidResult.terminal || fresh.attempt_count >= INBOUND_MEDIA_B1_MAX_ATTEMPTS;
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: sidResult.error,
      terminal,
    });
    return {
      ok: false,
      jobId: fresh.id,
      reason: sidResult.error,
      terminal,
    };
  }

  const mediaSid = sidResult.mediaSid;

  // Persist recovered SID if job had null (CAS: only if still null)
  if (!fresh.twilio_media_sid) {
    await supabaseServer
      .from("v2_inbound_media_job")
      .update({
        twilio_media_sid: mediaSid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fresh.id)
      .is("twilio_media_sid", null);
  }

  let bytes: Buffer;
  let responseContentType: string | null = null;
  try {
    const dl = await downloadTwilioMmsMediaBytes(
      { messageSid: fresh.message_sid, mediaSid },
      deps.downloadDeps
    );
    bytes = dl.bytes;
    responseContentType = dl.responseContentType;
  } catch (e) {
    const err =
      e instanceof TwilioMmsDownloadError
        ? e
        : new TwilioMmsDownloadError("network_error", { retryable: true, cause: e });

    const hitCap = fresh.attempt_count >= INBOUND_MEDIA_B1_MAX_ATTEMPTS;
    // 404: retryable until attempt cap (Twilio intermittent 404 docs)
    const terminal = hitCap || !err.retryable;

    console.info("[victory-media/mms-b1] download_failed", {
      ...logBase,
      error_code: err.code,
      stage: err.stage,
      http_status: err.httpStatus,
      abort_name: err.abortName,
      terminal,
    });

    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: err.code,
      terminal,
    });
    return { ok: false, jobId: fresh.id, reason: err.code, terminal };
  }

  const sniffed = sniffImageFormat(bytes);
  const contentType = storageMimeForSniffedImageFormat(sniffed);
  console.info("[victory-media/mms-b1] sniffed", {
    ...logBase,
    declared_mime: fresh.declared_content_type,
    response_mime: responseContentType,
    sniffed_format: sniffed,
    byte_count: bytes.length,
  });

  if (!contentType) {
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: `unsupported_format:${sniffed}`,
      terminal: true,
    });
    return {
      ok: false,
      jobId: fresh.id,
      reason: `unsupported_format:${sniffed}`,
      terminal: true,
    };
  }

  let tempPath: string;
  try {
    tempPath = victoryMediaMmsTempPath(fresh.clerk_user_id, fresh.id);
  } catch {
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: "invalid_temp_path",
      terminal: true,
    });
    return { ok: false, jobId: fresh.id, reason: "invalid_temp_path", terminal: true };
  }

  const upload = deps.uploadTemp ?? defaultUploadTemp;
  const removeTemp = deps.removeTemp ?? defaultRemoveTemp;

  try {
    await upload({
      bucket: VICTORY_MEDIA_BUCKET,
      path: tempPath,
      bytes,
      contentType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[victory-media/mms-b1] temp_upload_failed", {
      ...logBase,
      stage: "storage_upload",
      error_code: "temp_upload_failed",
      message: msg,
    });
    const terminal = fresh.attempt_count >= INBOUND_MEDIA_B1_MAX_ATTEMPTS;
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: "temp_upload_failed",
      terminal,
    });
    return { ok: false, jobId: fresh.id, reason: "temp_upload_failed", terminal };
  }

  // Final tombstone / deletion race check before success write
  const beforeSuccess = await loadInboundMediaJobById(fresh.id);
  if (!beforeSuccess || isInboundMediaJobTombstonedOrRemoved(beforeSuccess)) {
    await removeTemp({ bucket: VICTORY_MEDIA_BUCKET, path: tempPath });
    return { ok: false, jobId: fresh.id, reason: "tombstoned_race", terminal: true };
  }

  try {
    if (await deletionCheck(fresh.clerk_user_id)) {
      await removeTemp({ bucket: VICTORY_MEDIA_BUCKET, path: tempPath });
      await markExpired(fresh.id, "account_deletion_unresolved");
      return {
        ok: false,
        jobId: fresh.id,
        reason: "account_deletion_unresolved",
        terminal: true,
      };
    }
  } catch {
    await removeTemp({ bucket: VICTORY_MEDIA_BUCKET, path: tempPath });
    await markExpired(fresh.id, "account_deletion_lookup_failed");
    return {
      ok: false,
      jobId: fresh.id,
      reason: "account_deletion_lookup_failed",
      terminal: true,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: "normalizing",
      temp_storage_path: tempPath,
      last_error_code: null,
      next_retry_at: null,
      updated_at: nowIso,
    })
    .eq("id", fresh.id)
    .eq("status", "normalizing")
    .select("id")
    .maybeSingle();

  if (updErr || !updated) {
    await removeTemp({ bucket: VICTORY_MEDIA_BUCKET, path: tempPath });
    await markFailed({
      jobId: fresh.id,
      attemptCount: fresh.attempt_count,
      errorCode: "success_update_conflict",
      terminal: false,
    });
    return {
      ok: false,
      jobId: fresh.id,
      reason: "success_update_conflict",
      terminal: false,
    };
  }

  console.info("[victory-media/mms-b1] success", {
    ...logBase,
    temp_storage_path_set: true,
    sniffed_format: sniffed,
    byte_count: bytes.length,
  });

  return {
    ok: true,
    jobId: fresh.id,
    tempStoragePath: tempPath,
    sniffedFormat: sniffed,
  };
}

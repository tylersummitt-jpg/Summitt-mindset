/**
 * Slice C2 — canonicalize a C1-armed Body+photo MMS onto exactly one active Win.
 * Evidence/presentation only. Does not create Wins, infer photo meaning, send SMS,
 * or touch pending_semantics.
 *
 * attach_eligible is a list hint, not authorization. C2 revalidates current facts.
 */

import "server-only";

import sharp from "sharp";
import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import {
  isSemanticTargetWinTechnicallyEligible,
  type SemanticTargetWinLite,
} from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  applyInboundMmsC1Decision,
  casAwaitingAttachJob,
  confirmInboundMmsTerminalKindImmediatelyBeforeCas,
  evaluateAwaitingInboundMmsAttachment,
  INBOUND_MEDIA_C1_WAIT_RETRY_MS,
  INBOUND_MEDIA_C2_OWNED_LAST_ERROR_CODES,
  isInboundMediaJobC1ExpiresAtMalformed,
  isInboundMediaJobC1Ready,
  isInboundMediaSemanticTargetLineageErrorCode,
  loadInboundMmsCorrelationFacts,
  sameSidMediaJobCardinalityIsMulti,
  snapshotFromJob,
  type InboundMediaC2SemanticRetryErrorCode,
  type InboundMmsC1Decision,
  type InboundMmsC1MediaLite,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import {
  finalizeVictoryWinMedia,
  type FinalizeVictoryWinMediaResult,
} from "@/lib/victory-media/finalize-victory-win-media";
import { sniffImageFormat } from "@/lib/victory-media/sniff-image-format";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
} from "@/lib/victory-media/storage-paths";

export const INBOUND_MEDIA_PIPELINE_C2_LIMIT = 1;
export const INBOUND_MEDIA_C2_RETRY_MS = INBOUND_MEDIA_C1_WAIT_RETRY_MS;

export const INBOUND_MEDIA_C2_RETRY_ERROR_CODES = [
  "c2_storage_read_failed",
  "c2_metadata_failed",
  "c2_finalize_failed",
  "c2_stale_ownership",
] as const;

export type InboundMediaC2RetryErrorCode =
  (typeof INBOUND_MEDIA_C2_RETRY_ERROR_CODES)[number];

export type { InboundMediaC2SemanticRetryErrorCode };

export type InboundMediaC2RetryWriteCode =
  | InboundMediaC2RetryErrorCode
  | InboundMediaC2SemanticRetryErrorCode;

export type InboundMmsC2Result =
  | {
      ok: true;
      status: "attached" | "existing";
      jobId: string;
      winId: string;
    }
  | { ok: false; jobId: string; reason: string; terminal: boolean };

export type AttachInboundMmsC2Deps = {
  now?: Date;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  loadJob?: (jobId: string) => Promise<InboundMediaJobRow | null>;
  loadFacts?: typeof loadInboundMmsCorrelationFacts;
  finalize?: typeof finalizeVictoryWinMedia;
  downloadObject?: (args: { bucket: string; path: string }) => Promise<Buffer>;
  removeObjects?: (args: { bucket: string; paths: string[] }) => Promise<void>;
  readJpegMetadata?: (
    bytes: Buffer
  ) => Promise<{ width: number; height: number } | null>;
  applyDecision?: typeof applyInboundMmsC1Decision;
  confirmTerminal?: typeof confirmInboundMmsTerminalKindImmediatelyBeforeCas;
  casJob?: typeof casAwaitingAttachJob;
  loadTargetWin?: (winId: string) => Promise<SemanticTargetWinLite | null>;
  loadMediaForWin?: (args: {
    winId: string;
    clerkUserId: string;
  }) => Promise<InboundMmsC1MediaLite | null>;
};

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function isInboundMediaC2ListErrorCode(
  lastErrorCode: string | null
): boolean {
  return (
    typeof lastErrorCode === "string" &&
    (INBOUND_MEDIA_C2_OWNED_LAST_ERROR_CODES as readonly string[]).includes(
      lastErrorCode
    )
  );
}

function semanticTargetWinIdOf(job: InboundMediaJobRow): string | null {
  const id = job.semantic_target_win_id?.trim() ?? "";
  return id ? id : null;
}

/**
 * Durable D semantic-target lineage. UUID and/or semantic last_error_code.
 * Survives FK SET NULL of semantic_target_win_id. Never Mode A.
 */
export function isInboundMediaJobSemanticTargetOwned(job: {
  semantic_target_win_id?: string | null;
  last_error_code: string | null;
}): boolean {
  if (hasNonEmptyText(job.semantic_target_win_id)) return true;
  return isInboundMediaSemanticTargetLineageErrorCode(job.last_error_code);
}

/** Mode B: semantic-target lineage, including SET NULL leftover. */
export function isInboundMediaJobSemanticTargetMode(job: {
  semantic_target_win_id?: string | null;
  last_error_code: string | null;
}): boolean {
  return isInboundMediaJobSemanticTargetOwned(job);
}

function toSemanticRetryCode(
  errorCode: InboundMediaC2RetryWriteCode
): InboundMediaC2SemanticRetryErrorCode {
  if (
    errorCode === "c2_storage_read_failed" ||
    errorCode === "c2_semantic_storage_read_failed"
  ) {
    return "c2_semantic_storage_read_failed";
  }
  if (
    errorCode === "c2_metadata_failed" ||
    errorCode === "c2_semantic_metadata_failed"
  ) {
    return "c2_semantic_metadata_failed";
  }
  if (
    errorCode === "c2_finalize_failed" ||
    errorCode === "c2_semantic_finalize_failed"
  ) {
    return "c2_semantic_finalize_failed";
  }
  if (errorCode === "c2_semantic_target_missing") {
    return "c2_semantic_target_missing";
  }
  return "c2_semantic_stale_ownership";
}

/**
 * C2 due-list candidate. Expiry is NOT decided here — the worker revalidates.
 * pending_semantics can never match (status must be awaiting_attach).
 */
export function isInboundMediaJobC2DueListCandidate(
  row: {
    status: string;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution: string | null;
    attached_win_id: string | null;
    tombstoned_at: string | null;
    next_retry_at: string | null;
    last_error_code: string | null;
  },
  now: Date
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(row)) return false;
  if (row.status !== "awaiting_attach") return false;
  if (hasNonEmptyText(row.temp_storage_path)) return false;
  if (!hasNonEmptyText(row.normalized_storage_path)) return false;
  if (row.resolution != null) return false;
  if (hasNonEmptyText(row.attached_win_id)) return false;
  if (!isInboundMediaC2ListErrorCode(row.last_error_code)) return false;
  if (row.next_retry_at == null) return false;
  const due = new Date(row.next_retry_at).getTime();
  if (!Number.isFinite(due)) return false;
  return due <= now.getTime();
}

function blobLikeToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  throw new Error("unsupported_download_payload");
}

async function defaultDownloadObject(args: {
  bucket: string;
  path: string;
}): Promise<Buffer> {
  const { data, error } = await supabaseServer.storage
    .from(args.bucket)
    .download(args.path);
  if (error || !data) {
    throw new Error("download_failed");
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return blobLikeToBuffer(data);
  }
  if (
    typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer ===
    "function"
  ) {
    return Buffer.from(await (data as Blob).arrayBuffer());
  }
  throw new Error("download_failed");
}

async function defaultRemoveObjects(args: {
  bucket: string;
  paths: string[];
}): Promise<void> {
  if (args.paths.length === 0) return;
  const { error } = await supabaseServer.storage.from(args.bucket).remove(args.paths);
  if (error) {
    console.warn("[victory-media/mms-c2] storage_cleanup_failed", {
      path_suffixes: args.paths.map((p) => p.split("/").slice(-3).join("/")),
      message: error.message,
    });
  }
}

async function defaultReadJpegMetadata(
  bytes: Buffer
): Promise<{ width: number; height: number } | null> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return null;
  if (sniffImageFormat(bytes) !== "jpeg") return null;
  try {
    const meta = await sharp(bytes).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || meta.format !== "jpeg") return null;
    return { width, height };
  } catch {
    return null;
  }
}

async function defaultLoadTargetWin(
  winId: string
): Promise<SemanticTargetWinLite | null> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id, clerk_user_id, status, hidden_at")
    .eq("id", winId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    clerk_user_id: String(data.clerk_user_id ?? ""),
    status: String(data.status ?? ""),
    hidden_at: typeof data.hidden_at === "string" ? data.hidden_at : null,
  };
}

async function defaultLoadMediaForWin(args: {
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
  return {
    id: String(data.id ?? ""),
    win_id: String(data.win_id ?? ""),
    clerk_user_id: String(data.clerk_user_id ?? ""),
    source_type: String(data.source_type ?? ""),
    source_message_sid:
      typeof data.source_message_sid === "string" ? data.source_message_sid : null,
    source_media_ordinal:
      data.source_media_ordinal == null ? null : Number(data.source_media_ordinal),
  };
}

function isExactSameMmsCanonical(
  media: InboundMmsC1MediaLite | null,
  job: InboundMediaJobRow
): boolean {
  if (!media) return false;
  return (
    media.id === job.id &&
    media.clerk_user_id === job.clerk_user_id.trim() &&
    media.source_type === "inbound_mms" &&
    (media.source_message_sid ?? "").trim() === job.message_sid.trim() &&
    media.source_media_ordinal === job.media_ordinal
  );
}

function isSameMmsProvenanceWrongId(
  media: InboundMmsC1MediaLite | null,
  job: InboundMediaJobRow
): boolean {
  if (!media) return false;
  if (media.clerk_user_id !== job.clerk_user_id.trim()) return false;
  if (media.source_type !== "inbound_mms") return false;
  if ((media.source_message_sid ?? "").trim() !== job.message_sid.trim()) {
    return false;
  }
  if (media.source_media_ordinal !== job.media_ordinal) return false;
  return media.id !== job.id;
}

function failResult(
  jobId: string,
  reason: string,
  terminal: boolean
): InboundMmsC2Result {
  return { ok: false, jobId, reason, terminal };
}

function okAttached(
  jobId: string,
  winId: string,
  status: "attached" | "existing"
): InboundMmsC2Result {
  return { ok: true, status, jobId, winId };
}

async function applyC1(
  job: InboundMediaJobRow,
  decision: InboundMmsC1Decision,
  now: Date,
  applyDecision: typeof applyInboundMmsC1Decision
): Promise<InboundMmsC1Decision> {
  return applyDecision({ job, decision, now });
}

const TERMINAL_KINDS = new Set<InboundMmsC1Decision["kind"]>([
  "ambiguous_wins",
  "ambiguous_media",
  "web_priority_blocked",
  "other_mms_occupied",
  "expired",
  "deletion_blocked",
]);

async function maybeCleanupNorm(args: {
  job: InboundMediaJobRow;
  removeObjects: NonNullable<AttachInboundMmsC2Deps["removeObjects"]>;
}): Promise<void> {
  try {
    const master = victoryMediaMmsNormMasterPath(
      args.job.clerk_user_id,
      args.job.id
    );
    const card = victoryMediaMmsNormCardPath(args.job.clerk_user_id, args.job.id);
    await args.removeObjects({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [master, card],
    });
  } catch (e) {
    console.warn("[victory-media/mms-c2] norm_cleanup_failed", {
      job_id: args.job.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function retryC2(
  job: InboundMediaJobRow,
  now: Date,
  errorCode: InboundMediaC2RetryWriteCode,
  applyDecision: typeof applyInboundMmsC1Decision
): Promise<InboundMmsC2Result> {
  const written: InboundMediaC2RetryWriteCode =
    isInboundMediaJobSemanticTargetOwned(job)
      ? toSemanticRetryCode(errorCode)
      : errorCode;
  await applyC1(
    job,
    { kind: "error_retry", jobId: job.id, errorCode: written },
    now,
    applyDecision
  );
  return failResult(job.id, written, false);
}

async function casJobAttached(args: {
  job: InboundMediaJobRow;
  winId: string;
  now: Date;
  casJob: typeof casAwaitingAttachJob;
}): Promise<boolean> {
  const snap = snapshotFromJob(args.job);
  if (!snap || args.job.status !== "awaiting_attach") return false;
  return args.casJob({
    snapshot: snap,
    patch: {
      status: "attached",
      resolution: "attached",
      attached_win_id: args.winId,
      next_retry_at: null,
      last_error_code: null,
      updated_at: args.now.toISOString(),
    },
  });
}

async function replayExistingCanonical(args: {
  job: InboundMediaJobRow;
  media: InboundMmsC1MediaLite;
  now: Date;
  applyDecision: typeof applyInboundMmsC1Decision;
  casJob: typeof casAwaitingAttachJob;
  removeObjects: NonNullable<AttachInboundMmsC2Deps["removeObjects"]>;
}): Promise<InboundMmsC2Result> {
  const won = await casJobAttached({
    job: args.job,
    winId: args.media.win_id,
    now: args.now,
    casJob: args.casJob,
  });
  if (!won) {
    await applyC1(
      args.job,
      {
        kind: "error_retry",
        jobId: args.job.id,
        errorCode: "c2_stale_ownership",
      },
      args.now,
      args.applyDecision
    );
    return failResult(args.job.id, "c2_stale_ownership", false);
  }
  await maybeCleanupNorm({ job: args.job, removeObjects: args.removeObjects });
  return okAttached(args.job.id, args.media.win_id, "existing");
}

function classifyOccupancyMedia(
  media: InboundMmsC1MediaLite,
  job: InboundMediaJobRow
): InboundMmsC1Decision {
  if (media.clerk_user_id !== job.clerk_user_id.trim()) {
    return { kind: "error_retry", jobId: job.id, errorCode: "media_lookup_failed" };
  }
  if (media.source_type === "web_upload") {
    return { kind: "web_priority_blocked", jobId: job.id, winId: media.win_id };
  }
  if (isExactSameMmsCanonical(media, job) && media.win_id) {
    return {
      kind: "same_mms_replay",
      jobId: job.id,
      winId: media.win_id,
      mediaId: media.id,
    };
  }
  if (media.source_type === "inbound_mms") {
    if (isSameMmsProvenanceWrongId(media, job)) {
      return {
        kind: "error_retry",
        jobId: job.id,
        errorCode: "same_mms_media_id_mismatch",
      };
    }
    return { kind: "other_mms_occupied", jobId: job.id, winId: media.win_id };
  }
  return { kind: "other_mms_occupied", jobId: job.id, winId: media.win_id };
}

async function resolveAfterFinalizeConflict(args: {
  job: InboundMediaJobRow;
  winId: string;
  now: Date;
  loadFacts: typeof loadInboundMmsCorrelationFacts;
  applyDecision: typeof applyInboundMmsC1Decision;
  confirmTerminal: typeof confirmInboundMmsTerminalKindImmediatelyBeforeCas;
  casJob: typeof casAwaitingAttachJob;
  removeObjects: NonNullable<AttachInboundMmsC2Deps["removeObjects"]>;
  semanticTargetWinId?: string | null;
  loadMediaForWin?: NonNullable<AttachInboundMmsC2Deps["loadMediaForWin"]>;
}): Promise<InboundMmsC2Result> {
  const requiredWinId = args.semanticTargetWinId?.trim() || null;
  let facts: Awaited<ReturnType<typeof loadInboundMmsCorrelationFacts>>;
  try {
    facts = await args.loadFacts(args.job);
  } catch {
    return retryC2(args.job, args.now, "c2_finalize_failed", args.applyDecision);
  }

  if (isExactSameMmsCanonical(facts.provenanceMedia, args.job)) {
    if (requiredWinId && facts.provenanceMedia!.win_id !== requiredWinId) {
      return retryC2(args.job, args.now, "c2_stale_ownership", args.applyDecision);
    }
    return replayExistingCanonical({
      job: args.job,
      media: facts.provenanceMedia!,
      now: args.now,
      applyDecision: args.applyDecision,
      casJob: args.casJob,
      removeObjects: args.removeObjects,
    });
  }
  if (isSameMmsProvenanceWrongId(facts.provenanceMedia, args.job)) {
    if (requiredWinId) {
      return retryC2(args.job, args.now, "c2_stale_ownership", args.applyDecision);
    }
    const applied = await applyC1(
      args.job,
      {
        kind: "error_retry",
        jobId: args.job.id,
        errorCode: "same_mms_media_id_mismatch",
      },
      args.now,
      args.applyDecision
    );
    return failResult(args.job.id, applied.kind, false);
  }

  let occupying = facts.mediaByWinId.get(args.winId) ?? null;
  if (requiredWinId && args.loadMediaForWin) {
    try {
      occupying = await args.loadMediaForWin({
        winId: requiredWinId,
        clerkUserId: args.job.clerk_user_id,
      });
    } catch {
      return retryC2(args.job, args.now, "c2_finalize_failed", args.applyDecision);
    }
  }
  if (!occupying) {
    return retryC2(args.job, args.now, "c2_finalize_failed", args.applyDecision);
  }
  let decision = classifyOccupancyMedia(occupying, args.job);
  if (decision.kind === "same_mms_replay") {
    if (requiredWinId && occupying.win_id !== requiredWinId) {
      return retryC2(args.job, args.now, "c2_stale_ownership", args.applyDecision);
    }
    return replayExistingCanonical({
      job: args.job,
      media: occupying,
      now: args.now,
      applyDecision: args.applyDecision,
      casJob: args.casJob,
      removeObjects: args.removeObjects,
    });
  }
  if (
    decision.kind === "web_priority_blocked" ||
    decision.kind === "other_mms_occupied" ||
    decision.kind === "ambiguous_wins" ||
    decision.kind === "ambiguous_media"
  ) {
    try {
      decision = await args.confirmTerminal(args.job, decision);
    } catch {
      return retryC2(args.job, args.now, "c2_stale_ownership", args.applyDecision);
    }
  }
  const applied = await applyC1(args.job, decision, args.now, args.applyDecision);
  if (TERMINAL_KINDS.has(applied.kind)) {
    await maybeCleanupNorm({
      job: args.job,
      removeObjects: args.removeObjects,
    });
    return failResult(args.job.id, applied.kind, true);
  }
  return failResult(args.job.id, applied.kind, false);
}

async function lookupDeletion(
  clerkUserId: string,
  check: (id: string) => Promise<boolean>
): Promise<"clear" | "unresolved" | "lookup_failed"> {
  try {
    if (await check(clerkUserId)) return "unresolved";
    return "clear";
  } catch {
    return "lookup_failed";
  }
}

export async function listInboundMediaJobsForC2(
  limit: number,
  opts?: { now?: Date }
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, INBOUND_MEDIA_PIPELINE_C2_LIMIT));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,status,next_retry_at,temp_storage_path,normalized_storage_path,resolution,attached_win_id,tombstoned_at,last_error_code"
    )
    .eq("status", "awaiting_attach")
    .is("temp_storage_path", null)
    .is("resolution", null)
    .is("attached_win_id", null)
    .is("tombstoned_at", null)
    .not("normalized_storage_path", "is", null)
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", nowIso)
    .in("last_error_code", [...INBOUND_MEDIA_C2_OWNED_LAST_ERROR_CODES])
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
      last_error_code:
        typeof raw.last_error_code === "string" ? raw.last_error_code : null,
    };
    if (!row.id || !isInboundMediaJobC2DueListCandidate(row, now)) continue;
    ids.push(row.id);
    if (ids.length >= n) break;
  }
  return ids;
}

type CanonicalAttachCtx = {
  job: InboundMediaJobRow;
  winId: string;
  now: Date;
  deletionCheck: (id: string) => Promise<boolean>;
  loadFacts: typeof loadInboundMmsCorrelationFacts;
  finalizeFn: typeof finalizeVictoryWinMedia;
  downloadObject: NonNullable<AttachInboundMmsC2Deps["downloadObject"]>;
  removeObjects: NonNullable<AttachInboundMmsC2Deps["removeObjects"]>;
  readJpegMetadata: NonNullable<AttachInboundMmsC2Deps["readJpegMetadata"]>;
  applyDecision: typeof applyInboundMmsC1Decision;
  confirmTerminal: typeof confirmInboundMmsTerminalKindImmediatelyBeforeCas;
  casJob: typeof casAwaitingAttachJob;
  semanticTargetWinId: string | null;
  loadMediaForWin: NonNullable<AttachInboundMmsC2Deps["loadMediaForWin"]>;
};

async function runCanonicalAttach(ctx: CanonicalAttachCtx): Promise<InboundMmsC2Result> {
  const {
    job,
    winId,
    now,
    deletionCheck,
    loadFacts,
    finalizeFn,
    downloadObject,
    removeObjects,
    readJpegMetadata,
    applyDecision,
    confirmTerminal,
    casJob,
    semanticTargetWinId,
    loadMediaForWin,
  } = ctx;
  const semanticMode = !!semanticTargetWinId;

  let expectedMaster: string;
  let expectedCard: string;
  try {
    expectedMaster = victoryMediaMmsNormMasterPath(job.clerk_user_id, job.id);
    expectedCard = victoryMediaMmsNormCardPath(job.clerk_user_id, job.id);
  } catch {
    return retryC2(job, now, "c2_storage_read_failed", applyDecision);
  }
  if (job.normalized_storage_path!.trim() !== expectedMaster) {
    return retryC2(job, now, "c2_storage_read_failed", applyDecision);
  }

  const deletionBeforeRead = await lookupDeletion(job.clerk_user_id, deletionCheck);
  if (deletionBeforeRead !== "clear") {
    const applied = await applyC1(
      job,
      {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode:
          deletionBeforeRead === "unresolved"
            ? "account_deletion_unresolved"
            : "account_deletion_lookup_failed",
      },
      now,
      applyDecision
    );
    if (applied.kind === "deletion_blocked") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "deletion_blocked");
  }
  if (isInboundMediaJobExpiresAtPast(job, now)) {
    const applied = await applyC1(
      job,
      { kind: "expired", jobId: job.id },
      now,
      applyDecision
    );
    if (applied.kind === "expired") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "expired");
  }

  let masterBytes: Buffer;
  let cardBytes: Buffer;
  try {
    masterBytes = await downloadObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: expectedMaster,
    });
  } catch {
    return retryC2(job, now, "c2_storage_read_failed", applyDecision);
  }
  try {
    cardBytes = await downloadObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: expectedCard,
    });
  } catch {
    return retryC2(job, now, "c2_storage_read_failed", applyDecision);
  }

  const masterMeta = await readJpegMetadata(masterBytes);
  const cardMeta = await readJpegMetadata(cardBytes);
  if (!masterMeta || !cardMeta) {
    return retryC2(job, now, "c2_metadata_failed", applyDecision);
  }

  const deletionBeforePersist = await lookupDeletion(job.clerk_user_id, deletionCheck);
  if (deletionBeforePersist !== "clear") {
    const applied = await applyC1(
      job,
      {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode:
          deletionBeforePersist === "unresolved"
            ? "account_deletion_unresolved"
            : "account_deletion_lookup_failed",
      },
      now,
      applyDecision
    );
    if (applied.kind === "deletion_blocked") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "deletion_blocked");
  }
  if (isInboundMediaJobExpiresAtPast(job, now)) {
    const applied = await applyC1(
      job,
      { kind: "expired", jobId: job.id },
      now,
      applyDecision
    );
    if (applied.kind === "expired") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "expired");
  }

  let finalized: FinalizeVictoryWinMediaResult;
  try {
    finalized = await finalizeFn({
      mediaId: job.id,
      winId,
      clerkUserId: job.clerk_user_id,
      bucket: VICTORY_MEDIA_BUCKET,
      master: {
        bytes: masterBytes,
        width: masterMeta.width,
        height: masterMeta.height,
        byteSize: masterBytes.length,
      },
      card: {
        bytes: cardBytes,
        width: cardMeta.width,
        height: cardMeta.height,
        byteSize: cardBytes.length,
      },
      sourceType: "inbound_mms",
      sourceMessageSid: job.message_sid,
      sourceMediaOrdinal: job.media_ordinal,
      twilioMediaSid: job.twilio_media_sid,
      userSelected: false,
    });
  } catch {
    return retryC2(job, now, "c2_finalize_failed", applyDecision);
  }

  if (!finalized.ok) {
    if (
      finalized.code === "media_exists" ||
      finalized.code === "mms_provenance_conflict"
    ) {
      return resolveAfterFinalizeConflict({
        job,
        winId,
        now,
        loadFacts,
        applyDecision,
        confirmTerminal,
        casJob,
        removeObjects,
        semanticTargetWinId,
        loadMediaForWin,
      });
    }
    if (finalized.code === "win_not_attachable" || finalized.code === "win_not_found") {
      if (semanticMode) {
        try {
          const masterPath = victoryMediaMasterPath(job.clerk_user_id, job.id);
          const cardPath = victoryMediaCardPath(job.clerk_user_id, job.id);
          await removeObjects({
            bucket: VICTORY_MEDIA_BUCKET,
            paths: [masterPath, cardPath],
          });
        } catch {
          /* finalizer already attempted cleanup */
        }
        return retryC2(job, now, "c2_stale_ownership", applyDecision);
      }
      const applied = await applyC1(
        job,
        { kind: "waiting_for_win", jobId: job.id },
        now,
        applyDecision
      );
      try {
        const masterPath = victoryMediaMasterPath(job.clerk_user_id, job.id);
        const cardPath = victoryMediaCardPath(job.clerk_user_id, job.id);
        await removeObjects({
          bucket: VICTORY_MEDIA_BUCKET,
          paths: [masterPath, cardPath],
        });
      } catch {
        /* finalizer already attempted cleanup */
      }
      return failResult(job.id, applied.kind, false);
    }
    const retryCode: InboundMediaC2RetryErrorCode =
      finalized.code === "storage_upload_failed"
        ? "c2_finalize_failed"
        : finalized.code === "invalid_normalized_media"
          ? "c2_metadata_failed"
          : "c2_finalize_failed";
    return retryC2(job, now, retryCode, applyDecision);
  }

  if (finalized.media.id !== job.id.toLowerCase()) {
    if (semanticMode) {
      return retryC2(job, now, "c2_stale_ownership", applyDecision);
    }
    const applied = await applyC1(
      job,
      {
        kind: "error_retry",
        jobId: job.id,
        errorCode: "same_mms_media_id_mismatch",
      },
      now,
      applyDecision
    );
    return failResult(job.id, applied.kind, false);
  }

  if (semanticMode && finalized.media.winId !== semanticTargetWinId) {
    return retryC2(job, now, "c2_stale_ownership", applyDecision);
  }

  const deletionBeforeCas = await lookupDeletion(job.clerk_user_id, deletionCheck);
  if (deletionBeforeCas !== "clear") {
    return retryC2(job, now, "c2_stale_ownership", applyDecision);
  }

  const won = await casJobAttached({
    job,
    winId: finalized.media.winId,
    now,
    casJob,
  });
  if (!won) {
    return retryC2(job, now, "c2_stale_ownership", applyDecision);
  }

  await maybeCleanupNorm({ job, removeObjects });
  return okAttached(
    job.id,
    finalized.media.winId,
    finalized.status === "existing" ? "existing" : "attached"
  );
}

async function attachSemanticTargetC2(
  job: InboundMediaJobRow,
  ctx: {
    now: Date;
    deletionCheck: (id: string) => Promise<boolean>;
    loadFacts: typeof loadInboundMmsCorrelationFacts;
    finalizeFn: typeof finalizeVictoryWinMedia;
    downloadObject: NonNullable<AttachInboundMmsC2Deps["downloadObject"]>;
    removeObjects: NonNullable<AttachInboundMmsC2Deps["removeObjects"]>;
    readJpegMetadata: NonNullable<AttachInboundMmsC2Deps["readJpegMetadata"]>;
    applyDecision: typeof applyInboundMmsC1Decision;
    confirmTerminal: typeof confirmInboundMmsTerminalKindImmediatelyBeforeCas;
    casJob: typeof casAwaitingAttachJob;
    loadTargetWin: NonNullable<AttachInboundMmsC2Deps["loadTargetWin"]>;
    loadMediaForWin: NonNullable<AttachInboundMmsC2Deps["loadMediaForWin"]>;
  }
): Promise<InboundMmsC2Result> {
  const targetWinId = semanticTargetWinIdOf(job);
  if (!targetWinId) {
    return retryC2(job, ctx.now, "c2_semantic_target_missing", ctx.applyDecision);
  }

  let facts: Awaited<ReturnType<typeof loadInboundMmsCorrelationFacts>>;
  try {
    facts = await ctx.loadFacts(job);
  } catch {
    return retryC2(job, ctx.now, "c2_finalize_failed", ctx.applyDecision);
  }

  if (isExactSameMmsCanonical(facts.provenanceMedia, job)) {
    if (facts.provenanceMedia!.win_id !== targetWinId) {
      return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
    }
    return replayExistingCanonical({
      job,
      media: facts.provenanceMedia!,
      now: ctx.now,
      applyDecision: ctx.applyDecision,
      casJob: ctx.casJob,
      removeObjects: ctx.removeObjects,
    });
  }
  if (isSameMmsProvenanceWrongId(facts.provenanceMedia, job)) {
    return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
  }

  const deletion = await lookupDeletion(job.clerk_user_id, ctx.deletionCheck);
  if (deletion !== "clear") {
    const applied = await applyC1(
      job,
      {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode:
          deletion === "unresolved"
            ? "account_deletion_unresolved"
            : "account_deletion_lookup_failed",
      },
      ctx.now,
      ctx.applyDecision
    );
    if (applied.kind === "deletion_blocked") {
      await maybeCleanupNorm({ job, removeObjects: ctx.removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "deletion_blocked");
  }

  if (isInboundMediaJobC1ExpiresAtMalformed(job)) {
    return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
  }
  if (isInboundMediaJobExpiresAtPast(job, ctx.now)) {
    const applied = await applyC1(
      job,
      { kind: "expired", jobId: job.id },
      ctx.now,
      ctx.applyDecision
    );
    if (applied.kind === "expired") {
      await maybeCleanupNorm({ job, removeObjects: ctx.removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "expired");
  }

  if (!isInboundMediaJobC1Ready(job, ctx.now)) {
    return failResult(job.id, "not_c2_ready", false);
  }

  if (sameSidMediaJobCardinalityIsMulti(facts.siblings, job.id)) {
    let decision: InboundMmsC1Decision = { kind: "ambiguous_media", jobId: job.id };
    try {
      decision = await ctx.confirmTerminal(job, decision);
    } catch {
      return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
    }
    const applied = await applyC1(job, decision, ctx.now, ctx.applyDecision);
    if (TERMINAL_KINDS.has(applied.kind)) {
      await maybeCleanupNorm({ job, removeObjects: ctx.removeObjects });
      return failResult(job.id, applied.kind, true);
    }
    return failResult(job.id, applied.kind, false);
  }

  const targetWin = await ctx.loadTargetWin(targetWinId);
  if (!isSemanticTargetWinTechnicallyEligible(targetWin, job.clerk_user_id)) {
    return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
  }

  let occupying: InboundMmsC1MediaLite | null;
  try {
    occupying = await ctx.loadMediaForWin({
      winId: targetWinId,
      clerkUserId: job.clerk_user_id,
    });
  } catch {
    return retryC2(job, ctx.now, "c2_finalize_failed", ctx.applyDecision);
  }

  if (occupying) {
    let decision = classifyOccupancyMedia(occupying, job);
    if (decision.kind === "same_mms_replay") {
      if (occupying.win_id !== targetWinId) {
        return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
      }
      return replayExistingCanonical({
        job,
        media: occupying,
        now: ctx.now,
        applyDecision: ctx.applyDecision,
        casJob: ctx.casJob,
        removeObjects: ctx.removeObjects,
      });
    }
    if (
      decision.kind === "web_priority_blocked" ||
      decision.kind === "other_mms_occupied"
    ) {
      try {
        decision = await ctx.confirmTerminal(job, decision);
      } catch {
        return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
      }
      const applied = await applyC1(job, decision, ctx.now, ctx.applyDecision);
      if (TERMINAL_KINDS.has(applied.kind)) {
        await maybeCleanupNorm({ job, removeObjects: ctx.removeObjects });
        return failResult(job.id, applied.kind, true);
      }
      return failResult(job.id, applied.kind, false);
    }
    return retryC2(job, ctx.now, "c2_stale_ownership", ctx.applyDecision);
  }

  return runCanonicalAttach({
    job,
    winId: targetWinId,
    now: ctx.now,
    deletionCheck: ctx.deletionCheck,
    loadFacts: ctx.loadFacts,
    finalizeFn: ctx.finalizeFn,
    downloadObject: ctx.downloadObject,
    removeObjects: ctx.removeObjects,
    readJpegMetadata: ctx.readJpegMetadata,
    applyDecision: ctx.applyDecision,
    confirmTerminal: ctx.confirmTerminal,
    casJob: ctx.casJob,
    semanticTargetWinId: targetWinId,
    loadMediaForWin: ctx.loadMediaForWin,
  });
}

export async function tryAttachInboundMmsC2Job(
  jobId: string,
  deps: AttachInboundMmsC2Deps = {}
): Promise<InboundMmsC2Result | null> {
  const id = jobId.trim();
  if (!id) return null;
  const loadJob = deps.loadJob ?? loadInboundMediaJobById;
  const job = await loadJob(id);
  if (!job) return null;
  return evaluateAndAttachInboundMmsC2Job(job, deps);
}

export async function evaluateAndAttachInboundMmsC2Job(
  job: InboundMediaJobRow,
  deps: AttachInboundMmsC2Deps = {}
): Promise<InboundMmsC2Result> {
  const now = deps.now ?? new Date();
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;
  const loadFacts = deps.loadFacts ?? loadInboundMmsCorrelationFacts;
  const finalizeFn = deps.finalize ?? finalizeVictoryWinMedia;
  const downloadObject = deps.downloadObject ?? defaultDownloadObject;
  const removeObjects = deps.removeObjects ?? defaultRemoveObjects;
  const readJpegMetadata = deps.readJpegMetadata ?? defaultReadJpegMetadata;
  const applyDecision = deps.applyDecision ?? applyInboundMmsC1Decision;
  const confirmTerminal =
    deps.confirmTerminal ?? confirmInboundMmsTerminalKindImmediatelyBeforeCas;
  const casJob = deps.casJob ?? casAwaitingAttachJob;
  const loadTargetWin = deps.loadTargetWin ?? defaultLoadTargetWin;
  const loadMediaForWin = deps.loadMediaForWin ?? defaultLoadMediaForWin;

  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return failResult(job.id, "tombstoned", true);
  }

  const awaitingShape =
    job.status === "awaiting_attach" &&
    !hasNonEmptyText(job.temp_storage_path) &&
    hasNonEmptyText(job.normalized_storage_path) &&
    job.resolution == null &&
    !hasNonEmptyText(job.attached_win_id);

  if (!awaitingShape) {
    return failResult(job.id, "not_c2_ready", false);
  }

  if (isInboundMediaJobSemanticTargetMode(job)) {
    return attachSemanticTargetC2(job, {
      now,
      deletionCheck,
      loadFacts,
      finalizeFn,
      downloadObject,
      removeObjects,
      readJpegMetadata,
      applyDecision,
      confirmTerminal,
      casJob,
      loadTargetWin,
      loadMediaForWin,
    });
  }

  let facts: Awaited<ReturnType<typeof loadInboundMmsCorrelationFacts>>;
  try {
    facts = await loadFacts(job);
  } catch {
    return retryC2(job, now, "c2_finalize_failed", applyDecision);
  }

  if (isExactSameMmsCanonical(facts.provenanceMedia, job)) {
    return replayExistingCanonical({
      job,
      media: facts.provenanceMedia!,
      now,
      applyDecision,
      casJob,
      removeObjects,
    });
  }
  if (isSameMmsProvenanceWrongId(facts.provenanceMedia, job)) {
    const applied = await applyC1(
      job,
      {
        kind: "error_retry",
        jobId: job.id,
        errorCode: "same_mms_media_id_mismatch",
      },
      now,
      applyDecision
    );
    return failResult(job.id, applied.kind, false);
  }

  const deletion = await lookupDeletion(job.clerk_user_id, deletionCheck);
  if (deletion !== "clear") {
    const applied = await applyC1(
      job,
      {
        kind: "deletion_blocked",
        jobId: job.id,
        errorCode:
          deletion === "unresolved"
            ? "account_deletion_unresolved"
            : "account_deletion_lookup_failed",
      },
      now,
      applyDecision
    );
    if (applied.kind === "deletion_blocked") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "deletion_blocked");
  }

  if (isInboundMediaJobC1ExpiresAtMalformed(job)) {
    const applied = await applyC1(
      job,
      { kind: "error_retry", jobId: job.id, errorCode: "invalid_expires_at" },
      now,
      applyDecision
    );
    return failResult(job.id, applied.kind, false);
  }
  if (isInboundMediaJobExpiresAtPast(job, now)) {
    const applied = await applyC1(
      job,
      { kind: "expired", jobId: job.id },
      now,
      applyDecision
    );
    if (applied.kind === "expired") {
      await maybeCleanupNorm({ job, removeObjects });
    }
    return failResult(job.id, applied.kind, applied.kind === "expired");
  }

  if (!isInboundMediaJobC1Ready(job, now)) {
    return failResult(job.id, "not_c2_ready", false);
  }

  let decision = evaluateAwaitingInboundMmsAttachment({
    job,
    now,
    deletion: "clear",
    ...facts,
  });

  if (decision.kind === "same_mms_replay") {
    const occupying =
      facts.mediaByWinId.get(decision.winId) ?? facts.provenanceMedia;
    if (occupying && isExactSameMmsCanonical(occupying, job)) {
      return replayExistingCanonical({
        job,
        media: occupying,
        now,
        applyDecision,
        casJob,
        removeObjects,
      });
    }
  }

  if (decision.kind !== "attach_eligible") {
    if (
      decision.kind === "ambiguous_wins" ||
      decision.kind === "ambiguous_media" ||
      decision.kind === "web_priority_blocked" ||
      decision.kind === "other_mms_occupied"
    ) {
      try {
        decision = await confirmTerminal(job, decision);
      } catch {
        return retryC2(job, now, "c2_stale_ownership", applyDecision);
      }
    }
    const applied = await applyC1(job, decision, now, applyDecision);
    if (TERMINAL_KINDS.has(applied.kind)) {
      await maybeCleanupNorm({ job, removeObjects });
      return failResult(job.id, applied.kind, true);
    }
    return failResult(job.id, applied.kind, false);
  }

  return runCanonicalAttach({
    job,
    winId: decision.winId,
    now,
    deletionCheck,
    loadFacts,
    finalizeFn,
    downloadObject,
    removeObjects,
    readJpegMetadata,
    applyDecision,
    confirmTerminal,
    casJob,
    semanticTargetWinId: null,
    loadMediaForWin,
  });
}

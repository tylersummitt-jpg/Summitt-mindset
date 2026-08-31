/**
 * Slice D2b — post-grace photo-only clarification: re-eval, one natural SMS, pending_user.
 * Does not create Wins, pair answers (D2c), inspect image bytes, or process historical unarmed jobs.
 */

import "server-only";

import {
  hasUnresolvedAccountDeletionRequest,
  isAccountDeletionOutboundSmsError,
  isDeletionLookupFailure,
  isIntentionalDeletionSmsBlock,
} from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import { sendSMSChunked } from "@/lib/twilio";
import {
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import { isInboundMediaJobC1ExpiresAtMalformed } from "@/lib/victory-media/correlate-inbound-mms-c1";
import { claimInboundMediaJobSemanticTarget } from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  INBOUND_MEDIA_PIPELINE_D2A_LIMIT,
  inboundMmsD2aParkRetryIso,
} from "@/lib/victory-media/inbound-mms-d2a-codes";
import {
  isInboundMediaJobD2aDueListCandidate,
  loadInboundMmsD2aSemanticFacts,
  processInboundMmsD2aJob,
  type ProcessInboundMmsD2aResult,
} from "@/lib/victory-media/inbound-mms-d2a";
import type { InboundMmsD2aSemanticFacts } from "@/lib/victory-media/inbound-mms-d2a-semantics";
import {
  INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS,
  INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
  INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED,
  INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
  INBOUND_MEDIA_D2B_MODEL_RETRY_MS,
  INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2B_SEND_RETRY_MS,
  inboundMmsD2bClarificationIdempotencyKey,
  isInboundMediaD2bWakeLastErrorCode,
  isValidInboundMmsD2bClarificationBody,
} from "@/lib/victory-media/inbound-mms-d2b-codes";
import {
  checkInboundMmsD2bSmsEligibility,
  type InboundMmsD2bSmsEligibilityResult,
} from "@/lib/victory-media/inbound-mms-d2b-eligibility";
import {
  runInboundMmsD2bSemantics,
  type InboundMmsD2bSemanticResult,
} from "@/lib/victory-media/inbound-mms-d2b-semantics";
import {
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
} from "@/lib/victory-media/storage-paths";

export const INBOUND_MEDIA_PIPELINE_D2_LIMIT = INBOUND_MEDIA_PIPELINE_D2A_LIMIT;

export const INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES = [
  ...INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES,
  ...INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES,
] as const;

export type ProcessInboundMmsD2bResult =
  | {
      ok: true;
      jobId: string;
      action: "claimed" | "sent" | "parked" | "expired" | "noop";
    }
  | { ok: false; jobId: string; reason: string };

export type ProcessInboundMmsD2Result =
  | (ProcessInboundMmsD2aResult & { phase: "d2a" })
  | (ProcessInboundMmsD2bResult & { phase: "d2b" });

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function isInboundMediaJobD2bDueListCandidate(
  row: {
    status: string;
    last_error_code: string | null;
    next_retry_at: string | null;
    tombstoned_at: string | null;
    attached_win_id: string | null;
    semantic_target_win_id: string | null;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution?: string | null;
  },
  now: Date
): boolean {
  if (!isInboundMediaD2bWakeLastErrorCode(row.last_error_code)) return false;
  if (row.status === "tombstoned") return false;
  if (row.resolution === "removed") return false;
  if (hasNonEmptyText(row.tombstoned_at)) return false;
  if (row.status !== "pending_semantics") return false;
  if (row.resolution != null) return false;
  if (row.next_retry_at == null) return false;
  const due = new Date(row.next_retry_at).getTime();
  if (!Number.isFinite(due) || due > now.getTime()) return false;
  if (hasNonEmptyText(row.attached_win_id)) return false;
  if (hasNonEmptyText(row.semantic_target_win_id)) return false;
  if (hasNonEmptyText(row.temp_storage_path)) return false;
  if (!hasNonEmptyText(row.normalized_storage_path)) return false;
  return true;
}

export function isInboundMediaJobD2DueListCandidate(
  row: {
    status: string;
    last_error_code: string | null;
    next_retry_at: string | null;
    tombstoned_at: string | null;
    attached_win_id: string | null;
    semantic_target_win_id: string | null;
    temp_storage_path: string | null;
    normalized_storage_path: string | null;
    resolution?: string | null;
  },
  now: Date
): boolean {
  if (isInboundMediaJobD2bDueListCandidate(row, now)) return true;
  return isInboundMediaJobD2aDueListCandidate(row, now);
}

export async function listInboundMediaJobsForD2(
  limit: number,
  opts?: { now?: Date }
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, INBOUND_MEDIA_PIPELINE_D2_LIMIT));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,status,last_error_code,next_retry_at,tombstoned_at,attached_win_id,semantic_target_win_id,temp_storage_path,normalized_storage_path,resolution"
    )
    .eq("status", "pending_semantics")
    .in("last_error_code", [...INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES])
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", nowIso)
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("temp_storage_path", null)
    .is("resolution", null)
    .not("normalized_storage_path", "is", null)
    .order("next_retry_at", { ascending: true })
    .limit(n);
  if (error || !data) return [];
  const ids: string[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const row = {
      id: String(raw.id ?? ""),
      status: String(raw.status ?? ""),
      last_error_code:
        typeof raw.last_error_code === "string" ? raw.last_error_code : null,
      next_retry_at:
        typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
      tombstoned_at:
        typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
      attached_win_id:
        typeof raw.attached_win_id === "string" ? raw.attached_win_id : null,
      semantic_target_win_id:
        typeof raw.semantic_target_win_id === "string"
          ? raw.semantic_target_win_id
          : null,
      temp_storage_path:
        typeof raw.temp_storage_path === "string" ? raw.temp_storage_path : null,
      normalized_storage_path:
        typeof raw.normalized_storage_path === "string"
          ? raw.normalized_storage_path
          : null,
      resolution: typeof raw.resolution === "string" ? raw.resolution : null,
    };
    if (!row.id) continue;
    if (!isInboundMediaJobD2DueListCandidate(row, now)) continue;
    ids.push(row.id);
    if (ids.length >= n) break;
  }
  return ids;
}

async function defaultRemoveObjects(args: {
  bucket: string;
  paths: string[];
}): Promise<void> {
  if (args.paths.length === 0) return;
  const { error } = await supabaseServer.storage.from(args.bucket).remove(args.paths);
  if (error) {
    console.warn("[victory-media/mms-d2b] storage_cleanup_failed", {
      message: error.message,
    });
  }
}

async function defaultCasPark(args: {
  job: InboundMediaJobRow;
  patch: Record<string, unknown>;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .update(args.patch)
    .eq("id", args.job.id)
    .eq("clerk_user_id", args.job.clerk_user_id)
    .eq("status", "pending_semantics")
    .eq("updated_at", args.job.updated_at)
    .is("temp_storage_path", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("tombstoned_at", null)
    .is("resolution", null)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

export type InboundMmsD2bActiveClarificationLite = {
  id: string;
  resolution: string | null;
  followup_idempotency_key: string | null;
  status: string;
};

/**
 * Same conceptual liveness as D2c: expires_at must be parseable and strictly
 * in the future. Missing / blank / invalid / past → not an active blocker.
 */
function isInboundMediaJobClarificationExpiresAtLive(
  row: { expires_at?: string | null },
  now: Date
): boolean {
  if (row.expires_at == null) return false;
  const trimmed = String(row.expires_at).trim();
  if (!trimmed) return false;
  const t = new Date(trimmed).getTime();
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

export type InboundMmsD2bActiveClarificationShape = {
  status: string;
  resolution: string | null;
  followup_idempotency_key: string | null;
  tombstoned_at: string | null;
  expires_at: string | null;
};

/**
 * Live photo-clarification blocker. Aligns D2b serialization with D2c:
 * pending_user or reserved-unsent, only while expires_at > now.
 */
export function isInboundMediaJobD2bActiveClarification(
  row: InboundMmsD2bActiveClarificationShape,
  now: Date
): boolean {
  if (row.status !== "pending_semantics") return false;
  if (hasNonEmptyText(row.tombstoned_at)) return false;
  if (!isInboundMediaJobClarificationExpiresAtLive(row, now)) return false;
  if (row.resolution === "pending_user") return true;
  if (row.resolution == null && hasNonEmptyText(row.followup_idempotency_key)) {
    return true;
  }
  return false;
}

export async function listInboundMmsD2bActiveClarifications(args: {
  clerkUserId: string;
  excludeJobId: string;
  now: Date;
}): Promise<InboundMmsD2bActiveClarificationLite[] | "error"> {
  const nowIso = args.now.toISOString();
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("id,status,resolution,followup_idempotency_key,tombstoned_at,expires_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending_semantics")
    .neq("id", args.excludeJobId)
    .is("tombstoned_at", null)
    .not("expires_at", "is", null)
    .gt("expires_at", nowIso)
    .or(
      "resolution.eq.pending_user,followup_idempotency_key.not.is.null"
    )
    .limit(5);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  const out: InboundMmsD2bActiveClarificationLite[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    const resolution = typeof r.resolution === "string" ? r.resolution : null;
    const key =
      typeof r.followup_idempotency_key === "string"
        ? r.followup_idempotency_key
        : null;
    const shape: InboundMmsD2bActiveClarificationShape = {
      status: String(r.status ?? ""),
      resolution,
      followup_idempotency_key: key,
      tombstoned_at:
        typeof r.tombstoned_at === "string" ? r.tombstoned_at : null,
      expires_at: typeof r.expires_at === "string" ? r.expires_at : null,
    };
    if (!isInboundMediaJobD2bActiveClarification(shape, args.now)) continue;
    out.push({
      id,
      status: shape.status,
      resolution,
      followup_idempotency_key: key,
    });
  }
  return out;
}

async function defaultListD2ArmedSiblings(args: {
  clerkUserId: string;
  excludeJobId: string;
}): Promise<Array<{ id: string }> | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("id,last_error_code")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending_semantics")
    .neq("id", args.excludeJobId)
    .in("last_error_code", [...INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES])
    .is("resolution", null)
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .not("normalized_storage_path", "is", null)
    .limit(5);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  const out: Array<{ id: string }> = [];
  for (const raw of rows) {
    const id = typeof (raw as { id?: unknown }).id === "string"
      ? (raw as { id: string }).id
      : "";
    if (id) out.push({ id });
  }
  return out;
}

async function cleanupNorm(
  job: InboundMediaJobRow,
  removeObjects: NonNullable<ProcessInboundMmsD2bDeps["removeObjects"]>
): Promise<void> {
  try {
    const master = victoryMediaMmsNormMasterPath(job.clerk_user_id, job.id);
    const card = victoryMediaMmsNormCardPath(job.clerk_user_id, job.id);
    await removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths: [master, card] });
  } catch (e) {
    console.warn("[victory-media/mms-d2b] norm_cleanup_failed", {
      job_id: job.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export type ProcessInboundMmsD2bDeps = {
  now?: Date;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  loadJob?: (jobId: string) => Promise<InboundMediaJobRow | null>;
  listSiblingPhotos?: (args: {
    clerkUserId: string;
    excludeJobId: string;
  }) => Promise<Array<{ id: string }> | "error">;
  listActiveClarifications?: typeof listInboundMmsD2bActiveClarifications;
  loadFacts?: (args: {
    job: InboundMediaJobRow;
    now: Date;
  }) => Promise<InboundMmsD2aSemanticFacts | "error">;
  runSemantics?: (
    facts: InboundMmsD2aSemanticFacts
  ) => Promise<InboundMmsD2bSemanticResult>;
  claim?: typeof claimInboundMediaJobSemanticTarget;
  casPark?: (args: {
    job: InboundMediaJobRow;
    patch: Record<string, unknown>;
  }) => Promise<boolean>;
  checkSmsEligibility?: (
    clerkUserId: string
  ) => Promise<InboundMmsD2bSmsEligibilityResult>;
  sendSms?: (args: {
    to: string;
    body: string;
    clerkUserId: string;
  }) => Promise<{ firstSid: string }>;
  removeObjects?: (args: { bucket: string; paths: string[] }) => Promise<void>;
};

export async function processInboundMmsD2bJob(
  jobId: string,
  deps: ProcessInboundMmsD2bDeps = {}
): Promise<ProcessInboundMmsD2bResult> {
  const now = deps.now ?? new Date();
  const loadJob = deps.loadJob ?? loadInboundMediaJobById;
  const casPark = deps.casPark ?? defaultCasPark;
  const removeObjects = deps.removeObjects ?? defaultRemoveObjects;
  const listSiblings = deps.listSiblingPhotos ?? defaultListD2ArmedSiblings;
  const listActive =
    deps.listActiveClarifications ?? listInboundMmsD2bActiveClarifications;
  const loadFacts = deps.loadFacts ?? loadInboundMmsD2aSemanticFacts;
  const runSemantics = deps.runSemantics ?? runInboundMmsD2bSemantics;
  const claim = deps.claim ?? claimInboundMediaJobSemanticTarget;
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;
  const checkSms =
    deps.checkSmsEligibility ??
    ((clerkUserId: string) =>
      checkInboundMmsD2bSmsEligibility(
        { clerkUserId },
        { hasUnresolvedDeletion: deletionCheck }
      ));
  const sendSms =
    deps.sendSms ??
    (async (args: { to: string; body: string; clerkUserId: string }) => {
      const r = await sendSMSChunked({
        to: args.to,
        body: args.body,
        lastOutbound: {
          clerkUserId: args.clerkUserId,
          messageKind: "question",
          fullBodyForContext: args.body,
        },
      });
      return { firstSid: r.firstSid };
    });

  const job = await loadJob(jobId.trim());
  if (!job) return { ok: false, jobId, reason: "not_found" };
  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { ok: true, jobId: job.id, action: "noop" };
  }
  if (job.resolution === "pending_user") {
    return { ok: true, jobId: job.id, action: "noop" };
  }
  if (!isInboundMediaJobD2bDueListCandidate(job, now)) {
    return { ok: true, jobId: job.id, action: "noop" };
  }

  const expireNow = async (
    row: InboundMediaJobRow,
    errorCode: string
  ): Promise<ProcessInboundMmsD2bResult> => {
    const won = await casPark({
      job: row,
      patch: {
        status: "expired",
        resolution: "expired",
        next_retry_at: null,
        last_error_code: errorCode,
        updated_at: now.toISOString(),
      },
    });
    if (won) {
      await cleanupNorm(row, removeObjects);
      return { ok: true, jobId: row.id, action: "expired" };
    }
    return { ok: true, jobId: row.id, action: "noop" };
  };

  if (
    isInboundMediaJobC1ExpiresAtMalformed(job) ||
    isInboundMediaJobExpiresAtPast(job, now)
  ) {
    return expireNow(
      job,
      isInboundMediaJobC1ExpiresAtMalformed(job)
        ? "invalid_expires_at"
        : "expired"
    );
  }

  try {
    if (await deletionCheck(job.clerk_user_id)) {
      return expireNow(job, "account_deletion_unresolved");
    }
  } catch {
    const won = await casPark({
      job,
      patch: {
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2B_MODEL_RETRY_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }

  const parkStopOrIneligible = async (
    row: InboundMediaJobRow,
    code: string
  ): Promise<ProcessInboundMmsD2bResult> => {
    const won = await casPark({
      job: row,
      patch: {
        last_error_code: row.last_error_code,
        next_retry_at: inboundMmsD2aParkRetryIso({
          expiresAt: row.expires_at,
          now,
        }),
        updated_at: now.toISOString(),
      },
    });
    if (!won) return { ok: true, jobId: row.id, action: "noop" };
    console.info("[victory-media/mms-d2b] no_send", {
      job_id: row.id,
      reason: code,
    });
    return { ok: true, jobId: row.id, action: "parked" };
  };

  const expectedKey = inboundMmsD2bClarificationIdempotencyKey(job.id);

  const sendReserved = async (
    owned: InboundMediaJobRow,
    body: string
  ): Promise<ProcessInboundMmsD2bResult> => {
    const elig = await checkSms(owned.clerk_user_id);
    if (!elig.ok) {
      if (elig.reason === "account_deleting") {
        return expireNow(owned, "account_deletion_unresolved");
      }
      if (elig.reason === "lookup_failed") {
        const won = await casPark({
          job: owned,
          patch: {
            last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
            next_retry_at: new Date(
              now.getTime() + INBOUND_MEDIA_D2B_SEND_RETRY_MS
            ).toISOString(),
            updated_at: now.toISOString(),
          },
        });
        return { ok: true, jobId: owned.id, action: won ? "parked" : "noop" };
      }
      return parkStopOrIneligible(owned, elig.reason);
    }

    const fresh = await loadJob(owned.id);
    if (
      !fresh ||
      fresh.resolution === "pending_user" ||
      hasNonEmptyText(fresh.semantic_target_win_id) ||
      hasNonEmptyText(fresh.attached_win_id) ||
      fresh.status !== "pending_semantics"
    ) {
      return { ok: true, jobId: owned.id, action: "noop" };
    }
    if (fresh.followup_idempotency_key !== expectedKey) {
      return { ok: true, jobId: owned.id, action: "noop" };
    }
    if ((fresh.clarification_body?.trim() ?? "") !== body) {
      return { ok: true, jobId: owned.id, action: "noop" };
    }

    try {
      if (await deletionCheck(fresh.clerk_user_id)) {
        return expireNow(fresh, "account_deletion_unresolved");
      }
    } catch {
      const won = await casPark({
        job: fresh,
        patch: {
          last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
          next_retry_at: new Date(
            now.getTime() + INBOUND_MEDIA_D2B_SEND_RETRY_MS
          ).toISOString(),
          updated_at: now.toISOString(),
        },
      });
      return { ok: true, jobId: fresh.id, action: won ? "parked" : "noop" };
    }

    try {
      await sendSms({
        to: elig.phone,
        body,
        clerkUserId: fresh.clerk_user_id,
      });
    } catch (e) {
      if (
        isAccountDeletionOutboundSmsError(e) &&
        isIntentionalDeletionSmsBlock(e)
      ) {
        return expireNow(fresh, "account_deletion_unresolved");
      }
      if (
        isAccountDeletionOutboundSmsError(e) &&
        isDeletionLookupFailure(e)
      ) {
        const won = await casPark({
          job: fresh,
          patch: {
            last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
            next_retry_at: new Date(
              now.getTime() + INBOUND_MEDIA_D2B_SEND_RETRY_MS
            ).toISOString(),
            updated_at: now.toISOString(),
          },
        });
        return { ok: true, jobId: fresh.id, action: won ? "parked" : "noop" };
      }
      if (fresh.last_error_code === INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED) {
        const won = await casPark({
          job: fresh,
          patch: {
            last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
            next_retry_at: inboundMmsD2aParkRetryIso({
              expiresAt: fresh.expires_at,
              now,
            }),
            updated_at: now.toISOString(),
          },
        });
        return { ok: true, jobId: fresh.id, action: won ? "parked" : "noop" };
      }
      const won = await casPark({
        job: fresh,
        patch: {
          last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
          next_retry_at: new Date(
            now.getTime() + INBOUND_MEDIA_D2B_SEND_RETRY_MS
          ).toISOString(),
          updated_at: now.toISOString(),
        },
      });
      return { ok: true, jobId: fresh.id, action: won ? "parked" : "noop" };
    }

    const won = await casPark({
      job: fresh,
      patch: {
        status: "pending_semantics",
        resolution: "pending_user",
        next_retry_at: null,
        last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
        followup_idempotency_key: expectedKey,
        clarification_body: body,
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: fresh.id, action: won ? "sent" : "noop" };
  };

  const reservedBody = job.clarification_body?.trim() ?? "";
  if (job.followup_idempotency_key === expectedKey) {
    if (isValidInboundMmsD2bClarificationBody(reservedBody)) {
      return sendReserved(job, reservedBody);
    }
    const won = await casPark({
      job,
      patch: {
        last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
        next_retry_at: inboundMmsD2aParkRetryIso({
          expiresAt: job.expires_at,
          now,
        }),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }

  const smsElig = await checkSms(job.clerk_user_id);
  if (!smsElig.ok) {
    if (smsElig.reason === "account_deleting") {
      return expireNow(job, "account_deletion_unresolved");
    }
    if (smsElig.reason === "lookup_failed") {
      const won = await casPark({
        job,
        patch: {
          next_retry_at: new Date(
            now.getTime() + INBOUND_MEDIA_D2B_MODEL_RETRY_MS
          ).toISOString(),
          updated_at: now.toISOString(),
        },
      });
      return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
    }
    return parkStopOrIneligible(job, smsElig.reason);
  }

  const active = await listActive({
    clerkUserId: job.clerk_user_id,
    excludeJobId: job.id,
    now,
  });
  if (active === "error") {
    const won = await casPark({
      job,
      patch: {
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2B_MODEL_RETRY_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }
  if (active.length >= 1) {
    const won = await casPark({
      job,
      patch: {
        last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }

  const armModelFailed = async (): Promise<ProcessInboundMmsD2bResult> => {
    if (job.last_error_code === INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED) {
      const won = await casPark({
        job,
        patch: {
          last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
          next_retry_at: inboundMmsD2aParkRetryIso({
            expiresAt: job.expires_at,
            now,
          }),
          updated_at: now.toISOString(),
        },
      });
      return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
    }
    const won = await casPark({
      job,
      patch: {
        last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED,
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2B_MODEL_RETRY_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  };

  const facts = await loadFacts({ job, now });
  if (facts === "error") return armModelFailed();

  const semantic = await runSemantics(facts);
  if (!semantic.ok) return armModelFailed();

  if (semantic.decision === "attach_existing_win") {
    const siblings = await listSiblings({
      clerkUserId: job.clerk_user_id,
      excludeJobId: job.id,
    });
    if (siblings === "error" || siblings.length >= 1) {
      const won = await casPark({
        job,
        patch: {
          last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
          next_retry_at: new Date(
            now.getTime() + INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS
          ).toISOString(),
          updated_at: now.toISOString(),
        },
      });
      return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
    }
    const allowed = facts.candidate_wins.some(
      (w) =>
        w.id.trim().toLowerCase() === semantic.target_win_id.trim().toLowerCase()
    );
    if (!allowed) return armModelFailed();
    const claimed = await claim({
      jobId: job.id,
      clerkUserId: job.clerk_user_id,
      targetWinId: semantic.target_win_id,
      now,
      expectedResolution: null,
    });
    if (claimed.ok) {
      return { ok: true, jobId: job.id, action: "claimed" };
    }
    if (claimed.reason === "expired") return expireNow(job, "expired");
    if (claimed.reason === "deletion_blocked") {
      return expireNow(job, "account_deletion_unresolved");
    }
    if (
      claimed.reason === "stale_ownership" ||
      claimed.reason === "not_claimable" ||
      claimed.reason === "not_found" ||
      claimed.reason === "tombstoned"
    ) {
      return { ok: true, jobId: job.id, action: "noop" };
    }
    const won = await casPark({
      job,
      patch: {
        last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
        next_retry_at: inboundMmsD2aParkRetryIso({
          expiresAt: job.expires_at,
          now,
        }),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }

  if (
    semantic.decision !== "ask_clarification" ||
    !semantic.clarification_body
  ) {
    return armModelFailed();
  }

  const body = semantic.clarification_body;
  const reserved = await casPark({
    job,
    patch: {
      followup_idempotency_key: expectedKey,
      clarification_body: body,
      last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
      next_retry_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
  });
  if (!reserved) return { ok: true, jobId: job.id, action: "noop" };

  const afterReserve = await loadJob(job.id);
  if (!afterReserve) return { ok: true, jobId: job.id, action: "noop" };
  return sendReserved(afterReserve, body);
}

export async function processInboundMmsD2Job(
  jobId: string,
  deps?: ProcessInboundMmsD2bDeps
): Promise<ProcessInboundMmsD2Result> {
  const loadJob = deps?.loadJob ?? loadInboundMediaJobById;
  const job = await loadJob(jobId.trim());
  if (!job) return { ok: false, jobId, reason: "not_found", phase: "d2a" };
  if (isInboundMediaD2bWakeLastErrorCode(job.last_error_code)) {
    const r = await processInboundMmsD2bJob(jobId, deps);
    return { ...r, phase: "d2b" };
  }
  const r = await processInboundMmsD2aJob(
    jobId,
    deps as Parameters<typeof processInboundMmsD2aJob>[1]
  );
  return { ...r, phase: "d2a" };
}

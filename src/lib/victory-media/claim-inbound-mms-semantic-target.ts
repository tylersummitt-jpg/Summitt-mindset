/**
 * Slice D0 — durable semantic-target claim.
 * pending_semantics → awaiting_attach with semantic_target_win_id.
 *
 * Does not send SMS, create Wins, or attach canonical media.
 * D1/D2 will call this helper after semantic selection. D0 does not wire it
 * into B2, C1 apply, the pipeline, Twilio, or Coach.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import {
  INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT,
  INBOUND_MEDIA_C1_WAIT_RETRY_MS,
  isInboundMediaJobC1ExpiresAtMalformed,
  sameSidMediaJobCardinalityIsMulti,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import {
  isVictoryWinNewlyAttachable,
  type VictoryWinAttachableRow,
} from "@/lib/victory-media/finalize-victory-win-media";

export const INBOUND_MEDIA_SEMANTIC_TARGET_ERROR_CODE = "semantic_target" as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type SemanticTargetWinLite = VictoryWinAttachableRow;

export type SemanticTargetMediaLite = {
  id: string;
  win_id: string;
  source_type: string;
};

export type ClaimInboundMediaJobSemanticTargetInput = {
  jobId: string;
  clerkUserId: string;
  targetWinId: string;
  now?: Date;
  /**
   * Future D2 clarification rows may pass "pending_user".
   * Default null matches current production pending_semantics (resolution IS NULL).
   * Do not pass pending_user from D0 production callers — there are none.
   */
  expectedResolution?: string | null;
};

export type ClaimInboundMediaJobSemanticTargetResult =
  | { ok: true; jobId: string; targetWinId: string }
  | { ok: false; reason: string };

export type ClaimInboundMediaJobSemanticTargetDeps = {
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  loadJob?: (jobId: string) => Promise<InboundMediaJobRow | null>;
  loadTargetWin?: (winId: string) => Promise<SemanticTargetWinLite | null>;
  loadMediaForWin?: (args: {
    winId: string;
    clerkUserId: string;
  }) => Promise<SemanticTargetMediaLite | null | "error">;
  loadSameSidJobs?: (args: {
    clerkUserId: string;
    messageSid: string;
  }) => Promise<Array<{ id: string }> | "error">;
  casClaim?: (args: {
    job: InboundMediaJobRow;
    targetWinId: string;
    now: Date;
    expectedResolution: string | null;
  }) => Promise<boolean>;
};

/**
 * Pure pre-CAS shape. Does not decide semantic correctness of the Win.
 */
export function isInboundMediaJobSemanticTargetClaimable(
  job: InboundMediaJobRow,
  args: { clerkUserId: string; now: Date; expectedResolution?: string | null }
): boolean {
  const expectedResolution = args.expectedResolution ?? null;
  if (isInboundMediaJobTombstonedOrRemoved(job)) return false;
  if (job.status !== "pending_semantics") return false;
  if (job.clerk_user_id !== args.clerkUserId.trim()) return false;
  if (hasNonEmptyText(job.temp_storage_path)) return false;
  if (!hasNonEmptyText(job.normalized_storage_path)) return false;
  if (hasNonEmptyText(job.attached_win_id)) return false;
  if (hasNonEmptyText(job.semantic_target_win_id)) return false;
  if (hasNonEmptyText(job.tombstoned_at)) return false;
  if (expectedResolution == null) {
    if (job.resolution != null) return false;
  } else if (job.resolution !== expectedResolution) {
    return false;
  }
  if (isInboundMediaJobC1ExpiresAtMalformed(job)) return false;
  if (isInboundMediaJobExpiresAtPast(job, args.now)) return false;
  return true;
}

export function isSemanticTargetWinTechnicallyEligible(
  win: SemanticTargetWinLite | null,
  clerkUserId: string
): win is SemanticTargetWinLite {
  if (!win) return false;
  return isVictoryWinNewlyAttachable(win, clerkUserId.trim());
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
}): Promise<SemanticTargetMediaLite | null | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_win_media")
    .select("id, win_id, source_type")
    .eq("win_id", args.winId)
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();
  if (error) return "error";
  if (!data?.id) return null;
  return {
    id: String(data.id),
    win_id: String(data.win_id ?? ""),
    source_type: String(data.source_type ?? ""),
  };
}

async function defaultLoadSameSidJobs(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<Array<{ id: string }> | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select("id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("message_sid", args.messageSid)
    .limit(INBOUND_MEDIA_C1_SID_CARDINALITY_LIMIT);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => ({ id: String((raw as { id?: unknown }).id ?? "") })).filter((r) => r.id);
}

async function defaultCasClaim(args: {
  job: InboundMediaJobRow;
  targetWinId: string;
  now: Date;
  expectedResolution: string | null;
}): Promise<boolean> {
  const nowIso = args.now.toISOString();
  const nextRetry = new Date(
    args.now.getTime() + INBOUND_MEDIA_C1_WAIT_RETRY_MS
  ).toISOString();
  let q = supabaseServer
    .from("v2_inbound_media_job")
    .update({
      status: "awaiting_attach",
      semantic_target_win_id: args.targetWinId,
      resolution: null,
      last_error_code: INBOUND_MEDIA_SEMANTIC_TARGET_ERROR_CODE,
      next_retry_at: nextRetry,
      updated_at: nowIso,
    })
    .eq("id", args.job.id)
    .eq("clerk_user_id", args.job.clerk_user_id)
    .eq("status", "pending_semantics")
    .eq("normalized_storage_path", args.job.normalized_storage_path)
    .eq("updated_at", args.job.updated_at)
    .is("temp_storage_path", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("tombstoned_at", null);
  q =
    args.expectedResolution == null
      ? q.is("resolution", null)
      : q.eq("resolution", args.expectedResolution);
  const { data, error } = await q.select("id").maybeSingle();
  return !error && !!data;
}

/**
 * Validate a supplied target Win and CAS pending_semantics → awaiting_attach.
 * Does not interpret conversational meaning.
 */
export async function claimInboundMediaJobSemanticTarget(
  input: ClaimInboundMediaJobSemanticTargetInput,
  deps: ClaimInboundMediaJobSemanticTargetDeps = {}
): Promise<ClaimInboundMediaJobSemanticTargetResult> {
  const jobId = input.jobId.trim();
  const clerkUserId = input.clerkUserId.trim();
  const targetWinId = input.targetWinId.trim();
  const now = input.now ?? new Date();
  const expectedResolution = input.expectedResolution ?? null;

  if (!UUID_RE.test(jobId) || !UUID_RE.test(targetWinId) || !clerkUserId) {
    return { ok: false, reason: "invalid_input" };
  }
  if (expectedResolution != null && expectedResolution !== "pending_user") {
    return { ok: false, reason: "invalid_input" };
  }

  const loadJob = deps.loadJob ?? loadInboundMediaJobById;
  const loadTargetWin = deps.loadTargetWin ?? defaultLoadTargetWin;
  const loadMediaForWin = deps.loadMediaForWin ?? defaultLoadMediaForWin;
  const loadSameSidJobs = deps.loadSameSidJobs ?? defaultLoadSameSidJobs;
  const casClaim = deps.casClaim ?? defaultCasClaim;
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;

  const job = await loadJob(jobId);
  if (!job) return { ok: false, reason: "not_found" };
  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { ok: false, reason: "tombstoned" };
  }
  if (!isInboundMediaJobSemanticTargetClaimable(job, { clerkUserId, now, expectedResolution })) {
    if (isInboundMediaJobExpiresAtPast(job, now) || isInboundMediaJobC1ExpiresAtMalformed(job)) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "not_claimable" };
  }

  let deletion: "clear" | "unresolved" | "lookup_failed" = "clear";
  try {
    if (await deletionCheck(clerkUserId)) deletion = "unresolved";
  } catch {
    deletion = "lookup_failed";
  }
  if (deletion === "unresolved") return { ok: false, reason: "deletion_blocked" };
  if (deletion === "lookup_failed") return { ok: false, reason: "deletion_lookup_failed" };

  const siblings = await loadSameSidJobs({
    clerkUserId,
    messageSid: job.message_sid,
  });
  if (siblings === "error") return { ok: false, reason: "correlation_query_failed" };
  if (sameSidMediaJobCardinalityIsMulti(siblings, job.id)) {
    return { ok: false, reason: "ambiguous_media" };
  }

  const win = await loadTargetWin(targetWinId);
  if (!isSemanticTargetWinTechnicallyEligible(win, clerkUserId)) {
    return { ok: false, reason: "target_ineligible" };
  }

  const media = await loadMediaForWin({ winId: targetWinId, clerkUserId });
  if (media === "error") return { ok: false, reason: "media_lookup_failed" };
  if (media) return { ok: false, reason: "media_exists" };

  const won = await casClaim({ job, targetWinId, now, expectedResolution });
  if (!won) return { ok: false, reason: "stale_ownership" };
  return { ok: true, jobId: job.id, targetWinId };
}

/**
 * Slice 1 sibling of D0.
 * awaiting_attach + waiting_for_win (or pre-apply null last_error_code)
 * → set semantic_target_win_id, stay awaiting_attach, C2 Mode B.
 *
 * Does NOT accept pending_semantics. Do not weaken D0.
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
import type {
  ClaimInboundMediaJobSemanticTargetDeps,
  ClaimInboundMediaJobSemanticTargetResult,
  SemanticTargetMediaLite,
  SemanticTargetWinLite,
} from "@/lib/victory-media/claim-inbound-mms-semantic-target";

/** Keep equal to C1 wait / D0 semantic_target without importing those modules. */
const AWAITING_ATTACH_SEMANTIC_RETRY_MS = 60_000;
const SID_CARDINALITY_LIMIT = 2;
const SEMANTIC_TARGET_ERROR_CODE = "semantic_target";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isTargetWinTechnicallyEligible(
  win: SemanticTargetWinLite | null,
  clerkUserId: string
): win is SemanticTargetWinLite {
  if (!win) return false;
  return (
    win.clerk_user_id === clerkUserId.trim() &&
    win.status === "active" &&
    !hasNonEmptyText(win.hidden_at)
  );
}

function isExpiresAtMalformed(row: { expires_at?: string | null }): boolean {
  if (row.expires_at == null) return false;
  const trimmed = String(row.expires_at).trim();
  if (!trimmed) return false;
  const t = new Date(trimmed).getTime();
  return !Number.isFinite(t);
}

const WAITING_LAST_ERROR = "waiting_for_win";

export function isInboundMediaJobAwaitingAttachSemanticTargetClaimable(
  job: InboundMediaJobRow,
  args: { clerkUserId: string; now: Date }
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(job)) return false;
  if (job.status !== "awaiting_attach") return false;
  if (job.clerk_user_id !== args.clerkUserId.trim()) return false;
  if (hasNonEmptyText(job.temp_storage_path)) return false;
  if (!hasNonEmptyText(job.normalized_storage_path)) return false;
  if (hasNonEmptyText(job.attached_win_id)) return false;
  if (hasNonEmptyText(job.semantic_target_win_id)) return false;
  if (hasNonEmptyText(job.tombstoned_at)) return false;
  if (job.resolution != null) return false;
  const code = job.last_error_code;
  if (code != null && code !== WAITING_LAST_ERROR) return false;
  if (isExpiresAtMalformed(job)) return false;
  if (isInboundMediaJobExpiresAtPast(job, args.now)) return false;
  return true;
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
    .limit(SID_CARDINALITY_LIMIT);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((raw) => ({ id: String((raw as { id?: unknown }).id ?? "") }))
    .filter((r) => r.id);
}

function sameSidMediaJobCardinalityIsMulti(
  siblings: Array<{ id: string }>,
  jobId: string
): boolean {
  if (siblings.some((s) => s.id !== jobId)) return true;
  return siblings.length >= 2;
}

/**
 * Narrow same-SID active Win count. Pending claim is forbidden when any exist.
 * Query failure must fail closed. Does not import C1 evaluation.
 */
async function defaultLoadSameSidActiveWins(args: {
  clerkUserId: string;
  messageSid: string;
}): Promise<number | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id,clerk_user_id,source_message_sid,source_type,status,hidden_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("source_message_sid", args.messageSid)
    .eq("source_type", "sms_inbound");
  if (error) return "error";
  const clerk = args.clerkUserId.trim();
  const sid = args.messageSid.trim();
  const rows = Array.isArray(data) ? data : [];
  let n = 0;
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (String(r.clerk_user_id ?? "") !== clerk) continue;
    if (String(r.source_message_sid ?? "").trim() !== sid) continue;
    if (String(r.source_type ?? "") !== "sms_inbound") continue;
    if (String(r.status ?? "") !== "active") continue;
    if (hasNonEmptyText(typeof r.hidden_at === "string" ? r.hidden_at : null)) {
      continue;
    }
    if (!String(r.id ?? "").trim()) continue;
    n += 1;
  }
  return n;
}

async function defaultCasClaim(args: {
  job: InboundMediaJobRow;
  targetWinId: string;
  now: Date;
}): Promise<boolean> {
  const nowIso = args.now.toISOString();
  const nextRetry = new Date(
    args.now.getTime() + AWAITING_ATTACH_SEMANTIC_RETRY_MS
  ).toISOString();
  let q = supabaseServer
    .from("v2_inbound_media_job")
    .update({
      semantic_target_win_id: args.targetWinId,
      last_error_code: SEMANTIC_TARGET_ERROR_CODE,
      next_retry_at: nextRetry,
      updated_at: nowIso,
    })
    .eq("id", args.job.id)
    .eq("clerk_user_id", args.job.clerk_user_id)
    .eq("status", "awaiting_attach")
    .eq("normalized_storage_path", args.job.normalized_storage_path)
    .eq("updated_at", args.job.updated_at)
    .is("temp_storage_path", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("tombstoned_at", null)
    .is("resolution", null);
  q =
    args.job.last_error_code == null
      ? q.is("last_error_code", null)
      : q.eq("last_error_code", args.job.last_error_code);
  const { data, error } = await q.select("id").maybeSingle();
  return !error && !!data;
}

export type ClaimInboundMediaJobAwaitingAttachSemanticTargetInput = {
  jobId: string;
  clerkUserId: string;
  targetWinId: string;
  now?: Date;
};

export type ClaimInboundMediaJobAwaitingAttachSemanticTargetDeps =
  ClaimInboundMediaJobSemanticTargetDeps & {
    loadSameSidActiveWins?: (args: {
      clerkUserId: string;
      messageSid: string;
    }) => Promise<number | "error">;
  };

/**
 * Validate a supplied target Win and CAS awaiting_attach → semantic_target
 * without leaving awaiting_attach. D0 remains pending_semantics-only.
 */
export async function claimInboundMediaJobAwaitingAttachSemanticTarget(
  input: ClaimInboundMediaJobAwaitingAttachSemanticTargetInput,
  deps: ClaimInboundMediaJobAwaitingAttachSemanticTargetDeps = {}
): Promise<ClaimInboundMediaJobSemanticTargetResult> {
  const jobId = input.jobId.trim();
  const clerkUserId = input.clerkUserId.trim();
  const targetWinId = input.targetWinId.trim();
  const now = input.now ?? new Date();

  if (!UUID_RE.test(jobId) || !UUID_RE.test(targetWinId) || !clerkUserId) {
    return { ok: false, reason: "invalid_input" };
  }

  const loadJob = deps.loadJob ?? loadInboundMediaJobById;
  const loadTargetWin = deps.loadTargetWin ?? defaultLoadTargetWin;
  const loadMediaForWin = deps.loadMediaForWin ?? defaultLoadMediaForWin;
  const loadSameSidJobs = deps.loadSameSidJobs ?? defaultLoadSameSidJobs;
  const loadSameSidActiveWins =
    deps.loadSameSidActiveWins ?? defaultLoadSameSidActiveWins;
  const casClaim =
    deps.casClaim ??
    (async (args: {
      job: InboundMediaJobRow;
      targetWinId: string;
      now: Date;
      expectedResolution: string | null;
    }) => defaultCasClaim(args));
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;

  const job = await loadJob(jobId);
  if (!job) return { ok: false, reason: "not_found" };
  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { ok: false, reason: "tombstoned" };
  }
  if (!isInboundMediaJobAwaitingAttachSemanticTargetClaimable(job, { clerkUserId, now })) {
    if (isInboundMediaJobExpiresAtPast(job, now) || isExpiresAtMalformed(job)) {
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

  const sameSidWins = await loadSameSidActiveWins({
    clerkUserId,
    messageSid: job.message_sid,
  });
  if (sameSidWins === "error") return { ok: false, reason: "correlation_query_failed" };
  if (sameSidWins >= 1) return { ok: false, reason: "same_sid_win_exists" };

  const win = await loadTargetWin(targetWinId);
  if (!isTargetWinTechnicallyEligible(win, clerkUserId)) {
    return { ok: false, reason: "target_ineligible" };
  }

  const media = await loadMediaForWin({ winId: targetWinId, clerkUserId });
  if (media === "error") return { ok: false, reason: "media_lookup_failed" };
  if (media) return { ok: false, reason: "media_exists" };

  const won = await casClaim({ job, targetWinId, now, expectedResolution: null });
  if (!won) return { ok: false, reason: "stale_ownership" };
  return { ok: true, jobId: job.id, targetWinId };
}

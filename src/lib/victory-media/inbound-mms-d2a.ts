/**
 * Slice D2a — photo-only semantic worker: obvious existing-Win attach, grace, expiry.
 * Does not send SMS, create Wins, clarify, or process historical unarmed jobs.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { loadV2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  buildRecentExactThread72h,
  MORNING_TTO_THREAD_WINDOW_HOURS,
} from "@/lib/sms-recent-exact-thread-72h";
import {
  isInboundMediaJobExpiresAtPast,
  isInboundMediaJobTombstonedOrRemoved,
  loadInboundMediaJobById,
  type InboundMediaJobRow,
} from "@/lib/victory-media/claim-inbound-media-job";
import { isInboundMediaJobC1ExpiresAtMalformed } from "@/lib/victory-media/correlate-inbound-mms-c1";
import { claimInboundMediaJobSemanticTarget } from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import { listInboundMmsD1EligiblePendingJobs } from "@/lib/victory-media/inbound-mms-d1-pending-context";
import {
  INBOUND_MEDIA_D2A_MODEL_RETRY_MS,
  INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED,
  INBOUND_MEDIA_D2A_WIN_CAP,
  INBOUND_MEDIA_D2A_WIN_LOOKBACK_MS,
  INBOUND_MEDIA_PIPELINE_D2A_LIMIT,
  inboundMmsD2aGraceRetryIso,
  isInboundMediaD2aOwnedLastErrorCode,
} from "@/lib/victory-media/inbound-mms-d2a-codes";
import {
  runInboundMmsD2aSemantics,
  type InboundMmsD2aSemanticFacts,
  type InboundMmsD2aSemanticResult,
} from "@/lib/victory-media/inbound-mms-d2a-semantics";
import {
  victoryMediaMmsNormCardPath,
  victoryMediaMmsNormMasterPath,
} from "@/lib/victory-media/storage-paths";

export {
  INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2A_SEMANTIC_DUE,
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED,
  INBOUND_MEDIA_PIPELINE_D2A_LIMIT,
  inboundMmsD2aGraceRetryIso,
} from "@/lib/victory-media/inbound-mms-d2a-codes";

const WIN_TEXT_MAX = 160;
const THREAD_BODY_MAX = 400;
const THREAD_MSG_MAX = 30;

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type InboundMmsD2aWinCandidate = {
  id: string;
  text: string;
  occurred_at: string;
  relationship_type: string | null;
  commitment_id: string | null;
};

export type ProcessInboundMmsD2aResult =
  | {
      ok: true;
      jobId: string;
      action: "claimed" | "grace" | "parked" | "expired" | "noop";
    }
  | { ok: false; jobId: string; reason: string };

export type ProcessInboundMmsD2aDeps = {
  now?: Date;
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  loadJob?: (jobId: string) => Promise<InboundMediaJobRow | null>;
  listSiblingPhotos?: typeof listInboundMmsD1EligiblePendingJobs;
  loadFacts?: (args: {
    job: InboundMediaJobRow;
    now: Date;
  }) => Promise<InboundMmsD2aSemanticFacts | "error">;
  runSemantics?: (
    facts: InboundMmsD2aSemanticFacts
  ) => Promise<InboundMmsD2aSemanticResult>;
  claim?: typeof claimInboundMediaJobSemanticTarget;
  casPark?: (args: {
    job: InboundMediaJobRow;
    patch: Record<string, unknown>;
  }) => Promise<boolean>;
  removeObjects?: (args: { bucket: string; paths: string[] }) => Promise<void>;
};

export function isInboundMediaJobD2aDueListCandidate(
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
  if (row.status === "tombstoned") return false;
  if (row.resolution === "removed") return false;
  if (hasNonEmptyText(row.tombstoned_at)) return false;
  if (row.status !== "pending_semantics") return false;
  if (row.resolution != null) return false;
  if (!isInboundMediaD2aOwnedLastErrorCode(row.last_error_code)) return false;
  if (row.next_retry_at == null) return false;
  const due = new Date(row.next_retry_at).getTime();
  if (!Number.isFinite(due) || due > now.getTime()) return false;
  if (hasNonEmptyText(row.attached_win_id)) return false;
  if (hasNonEmptyText(row.semantic_target_win_id)) return false;
  if (hasNonEmptyText(row.temp_storage_path)) return false;
  if (!hasNonEmptyText(row.normalized_storage_path)) return false;
  return true;
}

export async function listInboundMediaJobsForD2a(
  limit: number,
  opts?: { now?: Date }
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, INBOUND_MEDIA_PIPELINE_D2A_LIMIT));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,status,last_error_code,next_retry_at,tombstoned_at,attached_win_id,semantic_target_win_id,temp_storage_path,normalized_storage_path,resolution"
    )
    .eq("status", "pending_semantics")
    .in("last_error_code", [...INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES])
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
    if (!isInboundMediaJobD2aDueListCandidate(row, now)) continue;
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
    console.warn("[victory-media/mms-d2a] storage_cleanup_failed", {
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

function conciseWinText(win: {
  display_title: string | null;
  display_body: string | null;
}): string {
  const title = win.display_title?.trim() ?? "";
  if (title) return title.slice(0, WIN_TEXT_MAX);
  return (win.display_body?.trim() ?? "").slice(0, WIN_TEXT_MAX);
}

export async function loadInboundMmsD2aSemanticFacts(args: {
  job: InboundMediaJobRow;
  now: Date;
}): Promise<InboundMmsD2aSemanticFacts | "error"> {
  const created = new Date(args.job.created_at).getTime();
  const ageMs = Number.isFinite(created)
    ? Math.max(0, args.now.getTime() - created)
    : 0;
  const pending_photo = {
    job_id: args.job.id,
    age_seconds: Math.floor(ageMs / 1000),
    message_sid: args.job.message_sid.trim(),
  };

  try {
    const afterIso = new Date(
      args.now.getTime() - INBOUND_MEDIA_D2A_WIN_LOOKBACK_MS
    ).toISOString();
    const { data: winRows, error: winErr } = await supabaseServer
      .from("v2_win")
      .select(
        "id,occurred_at,display_title,display_body,relationship_type,commitment_id"
      )
      .eq("clerk_user_id", args.job.clerk_user_id)
      .eq("status", "active")
      .is("hidden_at", null)
      .gte("occurred_at", afterIso)
      .order("occurred_at", { ascending: false })
      .limit(INBOUND_MEDIA_D2A_WIN_CAP);
    if (winErr) return "error";

    const winsRaw = Array.isArray(winRows) ? winRows : [];
    const winIds = winsRaw
      .map((r) => String((r as { id?: unknown }).id ?? "").trim())
      .filter(Boolean);

    let occupied = new Set<string>();
    if (winIds.length > 0) {
      const { data: mediaRows, error: mediaErr } = await supabaseServer
        .from("v2_win_media")
        .select("win_id")
        .eq("clerk_user_id", args.job.clerk_user_id)
        .in("win_id", winIds);
      if (mediaErr) return "error";
      occupied = new Set(
        (Array.isArray(mediaRows) ? mediaRows : [])
          .map((r) => String((r as { win_id?: unknown }).win_id ?? "").trim())
          .filter(Boolean)
      );
    }

    const candidate_wins: InboundMmsD2aWinCandidate[] = [];
    for (const raw of winsRaw) {
      const r = raw as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      if (!id || occupied.has(id)) continue;
      candidate_wins.push({
        id,
        text: conciseWinText({
          display_title:
            typeof r.display_title === "string" ? r.display_title : null,
          display_body: typeof r.display_body === "string" ? r.display_body : null,
        }),
        occurred_at: typeof r.occurred_at === "string" ? r.occurred_at : "",
        relationship_type:
          typeof r.relationship_type === "string" ? r.relationship_type : null,
        commitment_id:
          typeof r.commitment_id === "string" ? r.commitment_id : null,
      });
    }

    const { data: ident } = await supabaseServer
      .from("sms_identities")
      .select("timezone")
      .eq("clerk_user_id", args.job.clerk_user_id)
      .maybeSingle();
    const timezone = resolveUserTimezone(
      ident && typeof ident.timezone === "string" ? ident.timezone : null
    );

    const commitment = await getActiveCommitment(args.job.clerk_user_id);
    const current_goal = commitment
      ? getEffectiveCoachingAsk(commitment, args.now.getTime()).trim() ||
        commitment.behavior_statement.trim() ||
        null
      : null;

    const [{ data: profile }, threadMemory, timeline] = await Promise.all([
      supabaseServer
        .from("user_profiles")
        .select("preferred_name, identity_anchor_text, identity_source")
        .eq("clerk_user_id", args.job.clerk_user_id)
        .maybeSingle(),
      commitment
        ? loadV2CommitmentSmsThreadMemory({ commitmentId: commitment.id })
        : Promise.resolve(null),
      buildRecentExactThread72h({
        clerkUserId: args.job.clerk_user_id,
        commitmentId: commitment?.id ?? null,
        timezone,
        now: Number.isFinite(created) ? new Date(created) : args.now,
        windowHours: MORNING_TTO_THREAD_WINDOW_HOURS,
        preserveUserBodyFormatting: true,
      }),
    ]);

    const identityRaw =
      typeof profile?.identity_anchor_text === "string"
        ? profile.identity_anchor_text.trim()
        : "";
    const identitySource =
      typeof profile?.identity_source === "string"
        ? profile.identity_source.trim()
        : null;
    const identity =
      identityRaw && isQuotableIdentitySource(identitySource) ? identityRaw : null;

    const recent_thread = (timeline.messages ?? [])
      .slice(-THREAD_MSG_MAX)
      .map((m) => ({
        at: m.at,
        role: m.role,
        body: m.body.slice(0, THREAD_BODY_MAX),
      }));

    const openQ = threadMemory?.open_question_text?.trim() || null;

    return {
      pending_photo,
      recent_thread,
      candidate_wins,
      current_goal,
      identity,
      open_coach_question: openQ,
    };
  } catch (e) {
    console.warn("[victory-media/mms-d2a] facts_failed", {
      job_id: args.job.id,
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return {
      pending_photo,
      recent_thread: [],
      candidate_wins: [],
      current_goal: null,
      identity: null,
      open_coach_question: null,
    };
  }
}

async function cleanupNorm(
  job: InboundMediaJobRow,
  removeObjects: NonNullable<ProcessInboundMmsD2aDeps["removeObjects"]>
): Promise<void> {
  try {
    const master = victoryMediaMmsNormMasterPath(job.clerk_user_id, job.id);
    const card = victoryMediaMmsNormCardPath(job.clerk_user_id, job.id);
    await removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths: [master, card] });
  } catch (e) {
    console.warn("[victory-media/mms-d2a] norm_cleanup_failed", {
      job_id: job.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function processInboundMmsD2aJob(
  jobId: string,
  deps: ProcessInboundMmsD2aDeps = {}
): Promise<ProcessInboundMmsD2aResult> {
  const now = deps.now ?? new Date();
  const loadJob = deps.loadJob ?? loadInboundMediaJobById;
  const casPark = deps.casPark ?? defaultCasPark;
  const removeObjects = deps.removeObjects ?? defaultRemoveObjects;
  const listSiblings =
    deps.listSiblingPhotos ?? listInboundMmsD1EligiblePendingJobs;
  const loadFacts = deps.loadFacts ?? loadInboundMmsD2aSemanticFacts;
  const runSemantics = deps.runSemantics ?? runInboundMmsD2aSemantics;
  const claim = deps.claim ?? claimInboundMediaJobSemanticTarget;
  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;

  const job = await loadJob(jobId.trim());
  if (!job) return { ok: false, jobId, reason: "not_found" };
  if (isInboundMediaJobTombstonedOrRemoved(job)) {
    return { ok: true, jobId: job.id, action: "noop" };
  }
  if (!isInboundMediaJobD2aDueListCandidate(job, now)) {
    return { ok: true, jobId: job.id, action: "noop" };
  }

  const expireNow = async (
    errorCode: string
  ): Promise<ProcessInboundMmsD2aResult> => {
    const won = await casPark({
      job,
      patch: {
        status: "expired",
        resolution: "expired",
        next_retry_at: null,
        last_error_code: errorCode,
        updated_at: now.toISOString(),
      },
    });
    if (won) {
      await cleanupNorm(job, removeObjects);
      return { ok: true, jobId: job.id, action: "expired" };
    }
    return { ok: true, jobId: job.id, action: "noop" };
  };

  if (
    isInboundMediaJobC1ExpiresAtMalformed(job) ||
    isInboundMediaJobExpiresAtPast(job, now)
  ) {
    return expireNow(
      isInboundMediaJobC1ExpiresAtMalformed(job) ? "invalid_expires_at" : "expired"
    );
  }

  try {
    if (await deletionCheck(job.clerk_user_id)) {
      return expireNow("account_deletion_unresolved");
    }
  } catch {
    const won = await casPark({
      job,
      patch: {
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2A_MODEL_RETRY_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  }

  if (job.last_error_code === INBOUND_MEDIA_D2A_SEMANTIC_GRACE) {
    return { ok: true, jobId: job.id, action: "noop" };
  }

  const armGrace = async (): Promise<ProcessInboundMmsD2aResult> => {
    const won = await casPark({
      job,
      patch: {
        last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
        next_retry_at: inboundMmsD2aGraceRetryIso({
          createdAt: job.created_at,
          now,
        }),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "grace" : "noop" };
  };

  const armModelFailed = async (): Promise<ProcessInboundMmsD2aResult> => {
    if (job.last_error_code === INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED) {
      const won = await casPark({
        job,
        patch: {
          last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
          next_retry_at: inboundMmsD2aGraceRetryIso({
            createdAt: job.created_at,
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
        last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED,
        next_retry_at: new Date(
          now.getTime() + INBOUND_MEDIA_D2A_MODEL_RETRY_MS
        ).toISOString(),
        updated_at: now.toISOString(),
      },
    });
    return { ok: true, jobId: job.id, action: won ? "parked" : "noop" };
  };

  const siblings = await listSiblings(
    {
      clerkUserId: job.clerk_user_id,
      currentMessageSid: job.message_sid,
      now,
    },
    {}
  );
  if (siblings === "error") return armGrace();
  if (siblings.length >= 1) return armGrace();

  const facts = await loadFacts({ job, now });
  if (facts === "error") return armModelFailed();
  if (facts.candidate_wins.length === 0) return armGrace();

  const semantic = await runSemantics(facts);
  if (!semantic.ok) return armModelFailed();
  if (semantic.decision !== "attach_existing_win" || !semantic.target_win_id) {
    return armGrace();
  }

  const allowed = facts.candidate_wins.some(
    (w) =>
      w.id.trim().toLowerCase() === semantic.target_win_id!.trim().toLowerCase()
  );
  if (!allowed) return armGrace();

  const siblingsAgain = await listSiblings(
    {
      clerkUserId: job.clerk_user_id,
      currentMessageSid: job.message_sid,
      now,
    },
    {}
  );
  if (siblingsAgain === "error" || siblingsAgain.length >= 1) {
    return armGrace();
  }

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
  if (claimed.reason === "expired") return expireNow("expired");
  if (claimed.reason === "deletion_blocked") {
    return expireNow("account_deletion_unresolved");
  }
  if (
    claimed.reason === "stale_ownership" ||
    claimed.reason === "not_claimable" ||
    claimed.reason === "not_found" ||
    claimed.reason === "tombstoned"
  ) {
    return { ok: true, jobId: job.id, action: "noop" };
  }
  return armGrace();
}

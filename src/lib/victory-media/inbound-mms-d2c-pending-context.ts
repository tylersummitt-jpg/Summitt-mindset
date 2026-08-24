/**
 * Slice D2c — durable pending_user photo facts for the normal Sol interpreter.
 * Exact sent clarification_body only. Not a second semantic brain.
 * Does not claim, attach, send SMS, create Wins, expire jobs, or call a model.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import { isInboundMediaJobTombstonedOrRemoved } from "@/lib/victory-media/claim-inbound-media-job";
import {
  EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT,
  INBOUND_MEDIA_D1_PENDING_FETCH_CAP,
  INBOUND_MEDIA_D1_RECENT_WINS_CAP,
  type InboundMmsD1JobLite,
  type InboundMmsD1PendingCandidate,
  type InboundMmsD1PendingContext,
  type InboundMmsD1WinLite,
} from "@/lib/victory-media/inbound-mms-d1-pending-context";

export const INBOUND_MEDIA_D2C_PENDING_FETCH_CAP = INBOUND_MEDIA_D1_PENDING_FETCH_CAP;
export const INBOUND_MEDIA_D2C_RECENT_WINS_CAP = INBOUND_MEDIA_D1_RECENT_WINS_CAP;

const WIN_TEXT_MAX = 160;

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type InboundMmsD2cJobLite = InboundMmsD1JobLite & {
  clarification_body: string | null;
  followup_idempotency_key: string | null;
};

export type LoadInboundMmsD2cPendingContextInput = {
  clerkUserId: string;
  currentMessageSid: string;
  now?: Date;
};

export type LoadInboundMmsD2cPendingContextDeps = {
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  listPendingJobs?: (args: {
    clerkUserId: string;
    currentMessageSid: string;
    expiresAfterIso: string;
  }) => Promise<InboundMmsD2cJobLite[] | "error">;
  listBodySids?: (args: {
    clerkUserId: string;
    messageSids: string[];
  }) => Promise<Set<string> | "error">;
  listRecentWins?: (args: {
    clerkUserId: string;
  }) => Promise<InboundMmsD1WinLite[] | "error">;
  listWinIdsWithMedia?: (args: {
    clerkUserId: string;
    winIds: string[];
  }) => Promise<Set<string> | "error">;
};

export type InboundMmsD2cPendingContextResult =
  | InboundMmsD1PendingContext
  | "error";

function isExpiresAtValidAndFuture(
  job: { expires_at?: string | null },
  now: Date
): boolean {
  if (job.expires_at == null) return false;
  const trimmed = String(job.expires_at).trim();
  if (!trimmed) return false;
  const t = new Date(trimmed).getTime();
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}

function candidateCountFromLength(n: number): 0 | 1 | 2 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return 2;
}

export function isInboundMediaJobD2cPendingShape(
  job: InboundMmsD2cJobLite,
  args: { now: Date; currentMessageSid: string }
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(job)) return false;
  if (job.status !== "pending_semantics") return false;
  if (job.resolution !== "pending_user") return false;
  if (hasNonEmptyText(job.tombstoned_at)) return false;
  if (hasNonEmptyText(job.attached_win_id)) return false;
  if (hasNonEmptyText(job.semantic_target_win_id)) return false;
  if (hasNonEmptyText(job.temp_storage_path)) return false;
  if (!hasNonEmptyText(job.normalized_storage_path)) return false;
  if (!hasNonEmptyText(job.clarification_body)) return false;
  if (!hasNonEmptyText(job.followup_idempotency_key)) return false;
  if (!isExpiresAtValidAndFuture(job, args.now)) return false;
  const sid = job.message_sid.trim();
  if (!sid) return false;
  if (sid === args.currentMessageSid.trim()) return false;
  const created = new Date(job.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return true;
}

export function isInboundMmsPendingClarificationContext(
  ctx: InboundMmsD1PendingContext
): boolean {
  const body = ctx.candidate?.clarification_body?.trim() ?? "";
  return (
    ctx.candidate_count === 1 &&
    ctx.candidate != null &&
    ctx.candidate.awaiting_user === true &&
    body.length > 0
  );
}

function mapJobLite(raw: Record<string, unknown>): InboundMmsD2cJobLite {
  return {
    id: String(raw.id ?? ""),
    message_sid: String(raw.message_sid ?? ""),
    created_at: String(raw.created_at ?? ""),
    status: String(raw.status ?? ""),
    resolution: typeof raw.resolution === "string" ? raw.resolution : null,
    tombstoned_at: typeof raw.tombstoned_at === "string" ? raw.tombstoned_at : null,
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
    expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null,
    clarification_body:
      typeof raw.clarification_body === "string" ? raw.clarification_body : null,
    followup_idempotency_key:
      typeof raw.followup_idempotency_key === "string"
        ? raw.followup_idempotency_key
        : null,
  };
}

function conciseWinText(win: InboundMmsD1WinLite): string {
  const title = win.display_title?.trim() ?? "";
  if (title) return title.slice(0, WIN_TEXT_MAX);
  const body = win.display_body?.trim() ?? "";
  return body.slice(0, WIN_TEXT_MAX);
}

async function defaultListPendingJobs(args: {
  clerkUserId: string;
  currentMessageSid: string;
  expiresAfterIso: string;
}): Promise<InboundMmsD2cJobLite[] | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,message_sid,created_at,status,resolution,tombstoned_at,attached_win_id,semantic_target_win_id,temp_storage_path,normalized_storage_path,expires_at,clarification_body,followup_idempotency_key"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending_semantics")
    .eq("resolution", "pending_user")
    // last_error_code is intentionally unfiltered (clarification_due after send).
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("temp_storage_path", null)
    .not("normalized_storage_path", "is", null)
    .not("clarification_body", "is", null)
    .not("followup_idempotency_key", "is", null)
    .gt("expires_at", args.expiresAfterIso)
    .neq("message_sid", args.currentMessageSid)
    .order("created_at", { ascending: true })
    .limit(INBOUND_MEDIA_D2C_PENDING_FETCH_CAP);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => mapJobLite(raw as Record<string, unknown>)).filter((j) => j.id);
}

async function defaultListBodySids(args: {
  clerkUserId: string;
  messageSids: string[];
}): Promise<Set<string> | "error"> {
  if (args.messageSids.length === 0) return new Set();
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("message_sid")
    .eq("clerk_user_id", args.clerkUserId)
    .in("message_sid", args.messageSids);
  if (error) return "error";
  const out = new Set<string>();
  for (const raw of Array.isArray(data) ? data : []) {
    const sid = String((raw as { message_sid?: unknown }).message_sid ?? "").trim();
    if (sid) out.add(sid);
  }
  return out;
}

async function defaultListRecentWins(args: {
  clerkUserId: string;
}): Promise<InboundMmsD1WinLite[] | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select(
      "id,occurred_at,display_title,display_body,relationship_type,commitment_id"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "active")
    .is("hidden_at", null)
    .order("occurred_at", { ascending: false })
    .limit(INBOUND_MEDIA_D2C_RECENT_WINS_CAP);
  if (error) return "error";
  const rows = Array.isArray(data) ? data : [];
  const out: InboundMmsD1WinLite[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      occurred_at: typeof r.occurred_at === "string" ? r.occurred_at : "",
      display_title: typeof r.display_title === "string" ? r.display_title : null,
      display_body: typeof r.display_body === "string" ? r.display_body : null,
      relationship_type:
        typeof r.relationship_type === "string" ? r.relationship_type : null,
      commitment_id: typeof r.commitment_id === "string" ? r.commitment_id : null,
    });
  }
  return out;
}

async function defaultListWinIdsWithMedia(args: {
  clerkUserId: string;
  winIds: string[];
}): Promise<Set<string> | "error"> {
  if (args.winIds.length === 0) return new Set();
  const { data, error } = await supabaseServer
    .from("v2_win_media")
    .select("win_id")
    .eq("clerk_user_id", args.clerkUserId)
    .in("win_id", args.winIds);
  if (error) return "error";
  const out = new Set<string>();
  for (const raw of Array.isArray(data) ? data : []) {
    const id = String((raw as { win_id?: unknown }).win_id ?? "").trim();
    if (id) out.add(id);
  }
  return out;
}

export function buildInboundMmsD2cCandidateFact(
  job: InboundMmsD2cJobLite,
  now: Date
): InboundMmsD1PendingCandidate {
  const created = new Date(job.created_at).getTime();
  const ageMs = Number.isFinite(created) ? Math.max(0, now.getTime() - created) : 0;
  return {
    job_id: job.id,
    age_seconds: Math.floor(ageMs / 1000),
    message_sid: job.message_sid.trim(),
    normalized_ready: true,
    awaiting_user: true,
    clarification_body: (job.clarification_body ?? "").trim(),
  };
}

/**
 * Current eligible D2c pending_user jobs for this clerk.
 * Sent clarification only. Same law for interpreter load and claim-time revalidation.
 * Returns "error" on lookup failure (fail closed).
 */
export async function listInboundMmsD2cEligiblePendingJobs(
  input: LoadInboundMmsD2cPendingContextInput,
  deps: LoadInboundMmsD2cPendingContextDeps = {}
): Promise<InboundMmsD2cJobLite[] | "error"> {
  const clerkUserId = input.clerkUserId.trim();
  const currentMessageSid = input.currentMessageSid.trim();
  const now = input.now ?? new Date();
  if (!clerkUserId || !currentMessageSid) {
    return [];
  }

  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;
  try {
    if (await deletionCheck(clerkUserId)) {
      return [];
    }
  } catch {
    return "error";
  }

  const expiresAfterIso = now.toISOString();
  const listPendingJobs = deps.listPendingJobs ?? defaultListPendingJobs;
  const listBodySids = deps.listBodySids ?? defaultListBodySids;

  let listed: InboundMmsD2cJobLite[] | "error";
  try {
    listed = await listPendingJobs({
      clerkUserId,
      currentMessageSid,
      expiresAfterIso,
    });
  } catch {
    return "error";
  }
  if (listed === "error") return "error";

  const shapeOk = listed.filter((job) =>
    isInboundMediaJobD2cPendingShape(job, { now, currentMessageSid })
  );
  const sids = shapeOk.map((j) => j.message_sid.trim()).filter(Boolean);
  let bodySids: Set<string> | "error";
  try {
    bodySids = await listBodySids({ clerkUserId, messageSids: sids });
  } catch {
    return "error";
  }
  if (bodySids === "error") return "error";

  return shapeOk.filter((j) => !bodySids.has(j.message_sid.trim()));
}

/**
 * Durable pending_user photo + exact sent question for the current inbound text turn.
 * Lookup failure returns "error" so callers do not fall through to D1.
 */
export async function loadInboundMmsD2cPendingContext(
  input: LoadInboundMmsD2cPendingContextInput,
  deps: LoadInboundMmsD2cPendingContextDeps = {}
): Promise<InboundMmsD2cPendingContextResult> {
  const clerkUserId = input.clerkUserId.trim();
  const now = input.now ?? new Date();
  const imageOnly = await listInboundMmsD2cEligiblePendingJobs(input, deps);
  if (imageOnly === "error") return "error";

  const candidate_count = candidateCountFromLength(imageOnly.length);
  if (candidate_count !== 1) {
    return {
      candidate_count,
      candidate: null,
      recent_wins: [],
    };
  }

  const listRecentWins = deps.listRecentWins ?? defaultListRecentWins;
  const listWinIdsWithMedia = deps.listWinIdsWithMedia ?? defaultListWinIdsWithMedia;

  const job = imageOnly[0]!;
  const winsListed = await listRecentWins({ clerkUserId });
  if (winsListed === "error") {
    return {
      candidate_count: 1,
      candidate: buildInboundMmsD2cCandidateFact(job, now),
      recent_wins: [],
    };
  }

  const winIds = winsListed.map((w) => w.id);
  const withMedia = await listWinIdsWithMedia({ clerkUserId, winIds });
  const mediaSet = withMedia === "error" ? new Set<string>() : withMedia;

  const recent_wins = winsListed.map((w) => ({
    id: w.id,
    text: conciseWinText(w),
    occurred_at: w.occurred_at,
    relationship_type: w.relationship_type,
    commitment_id: w.commitment_id,
    has_media: mediaSet.has(w.id),
  }));

  return {
    candidate_count: 1,
    candidate: buildInboundMmsD2cCandidateFact(job, now),
    recent_wins,
  };
}

export { EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT as EMPTY_INBOUND_MMS_D2C_PENDING_CONTEXT };

/**
 * Live pending_user clarification outranks D1 unresolved photos.
 * Lookup failure is distinct from zero candidates and must not fall through to D1.
 */
export function inboundPendingMediaSourceFromD2c(
  d2c: InboundMmsD2cPendingContextResult
): "clarification" | "d1" | "error" {
  if (d2c === "error") return "error";
  if (d2c.candidate_count >= 1) return "clarification";
  return "d1";
}

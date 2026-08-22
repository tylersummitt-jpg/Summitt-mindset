/**
 * Slice D1 — bounded pending image-only photo facts for Sol interpreter.
 * Conversational candidate window only (not media TTL, not semantic evidence).
 * The interpreter decides whether later text refers to the photo.
 * Does not claim, attach, send SMS, expire jobs, or call a model.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";
import { isInboundMediaJobTombstonedOrRemoved } from "@/lib/victory-media/claim-inbound-media-job";

/**
 * D1 conversational candidate window only.
 * Not semantic evidence and not media expiry (B2 TTL remains 72h).
 */
export const INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS = 30 * 60 * 1000;
export const INBOUND_MEDIA_D1_PENDING_FETCH_CAP = 2;
export const INBOUND_MEDIA_D1_RECENT_WINS_CAP = 7;

const WIN_TEXT_MAX = 160;

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type InboundMmsD1PendingCandidate = {
  job_id: string;
  age_seconds: number;
  message_sid: string;
  normalized_ready: true;
};

export type InboundMmsD1RecentWin = {
  id: string;
  text: string;
  occurred_at: string;
  relationship_type: string | null;
  commitment_id: string | null;
  has_media: boolean;
};

export type InboundMmsD1PendingContext = {
  candidate_count: 0 | 1 | 2;
  candidate: InboundMmsD1PendingCandidate | null;
  recent_wins: InboundMmsD1RecentWin[];
};

export const EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT: InboundMmsD1PendingContext = {
  candidate_count: 0,
  candidate: null,
  recent_wins: [],
};

export type InboundMmsD1JobLite = {
  id: string;
  message_sid: string;
  created_at: string;
  status: string;
  resolution: string | null;
  tombstoned_at: string | null;
  attached_win_id: string | null;
  semantic_target_win_id: string | null;
  temp_storage_path: string | null;
  normalized_storage_path: string | null;
  expires_at: string | null;
};

export type InboundMmsD1WinLite = {
  id: string;
  occurred_at: string;
  display_title: string | null;
  display_body: string | null;
  relationship_type: string | null;
  commitment_id: string | null;
};

export type LoadInboundMmsD1PendingContextInput = {
  clerkUserId: string;
  currentMessageSid: string;
  now?: Date;
};

export type LoadInboundMmsD1PendingContextDeps = {
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  listPendingJobs?: (args: {
    clerkUserId: string;
    currentMessageSid: string;
    createdAfterIso: string;
    expiresAfterIso: string;
  }) => Promise<InboundMmsD1JobLite[] | "error">;
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

export function isInboundMediaJobD1PendingShape(
  job: InboundMmsD1JobLite,
  args: { now: Date; currentMessageSid: string; createdAfterMs: number }
): boolean {
  if (isInboundMediaJobTombstonedOrRemoved(job)) return false;
  if (job.status !== "pending_semantics") return false;
  if (job.resolution != null) return false;
  if (hasNonEmptyText(job.tombstoned_at)) return false;
  if (hasNonEmptyText(job.attached_win_id)) return false;
  if (hasNonEmptyText(job.semantic_target_win_id)) return false;
  if (hasNonEmptyText(job.temp_storage_path)) return false;
  if (!hasNonEmptyText(job.normalized_storage_path)) return false;
  if (!isExpiresAtValidAndFuture(job, args.now)) return false;
  const sid = job.message_sid.trim();
  if (!sid) return false;
  if (sid === args.currentMessageSid.trim()) return false;
  const created = new Date(job.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  if (created < args.createdAfterMs) return false;
  return true;
}

function mapJobLite(raw: Record<string, unknown>): InboundMmsD1JobLite {
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
  createdAfterIso: string;
  expiresAfterIso: string;
}): Promise<InboundMmsD1JobLite[] | "error"> {
  const { data, error } = await supabaseServer
    .from("v2_inbound_media_job")
    .select(
      "id,message_sid,created_at,status,resolution,tombstoned_at,attached_win_id,semantic_target_win_id,temp_storage_path,normalized_storage_path,expires_at"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending_semantics")
    // D2a last_error_code (semantic_due/grace/model_failed) is intentionally
    // unfiltered so later D1 text can still rescue a grace-parked photo.
    .is("resolution", null)
    .is("tombstoned_at", null)
    .is("attached_win_id", null)
    .is("semantic_target_win_id", null)
    .is("temp_storage_path", null)
    .not("normalized_storage_path", "is", null)
    .gt("expires_at", args.expiresAfterIso)
    .gte("created_at", args.createdAfterIso)
    .neq("message_sid", args.currentMessageSid)
    .order("created_at", { ascending: true })
    .limit(INBOUND_MEDIA_D1_PENDING_FETCH_CAP);
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
    .limit(INBOUND_MEDIA_D1_RECENT_WINS_CAP);
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

export function buildInboundMmsD1CandidateFact(
  job: InboundMmsD1JobLite,
  now: Date
): InboundMmsD1PendingCandidate {
  const created = new Date(job.created_at).getTime();
  const ageMs = Number.isFinite(created) ? Math.max(0, now.getTime() - created) : 0;
  return {
    job_id: job.id,
    age_seconds: Math.floor(ageMs / 1000),
    message_sid: job.message_sid.trim(),
    normalized_ready: true,
  };
}

/**
 * Current eligible D1 pending image-only jobs for this clerk.
 * Same law for interpreter context load and claim-time revalidation. Not semantic.
 * Returns "error" on lookup failure (fail closed).
 */
export async function listInboundMmsD1EligiblePendingJobs(
  input: LoadInboundMmsD1PendingContextInput,
  deps: LoadInboundMmsD1PendingContextDeps = {}
): Promise<InboundMmsD1JobLite[] | "error"> {
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
    return [];
  }

  const createdAfterMs = now.getTime() - INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS;
  const createdAfterIso = new Date(createdAfterMs).toISOString();
  const expiresAfterIso = now.toISOString();

  const listPendingJobs = deps.listPendingJobs ?? defaultListPendingJobs;
  const listBodySids = deps.listBodySids ?? defaultListBodySids;

  const listed = await listPendingJobs({
    clerkUserId,
    currentMessageSid,
    createdAfterIso,
    expiresAfterIso,
  });
  if (listed === "error") return "error";

  const shapeOk = listed.filter((job) =>
    isInboundMediaJobD1PendingShape(job, {
      now,
      currentMessageSid,
      createdAfterMs,
    })
  );
  const sids = shapeOk.map((j) => j.message_sid.trim()).filter(Boolean);
  const bodySids = await listBodySids({ clerkUserId, messageSids: sids });
  if (bodySids === "error") return "error";

  return shapeOk.filter((j) => !bodySids.has(j.message_sid.trim()));
}

/**
 * Bounded pending image-only facts for the current inbound text turn.
 * Fail closed to empty on deletion, query error, or malformed rows.
 */
export async function loadInboundMmsD1PendingContext(
  input: LoadInboundMmsD1PendingContextInput,
  deps: LoadInboundMmsD1PendingContextDeps = {}
): Promise<InboundMmsD1PendingContext> {
  const clerkUserId = input.clerkUserId.trim();
  const now = input.now ?? new Date();
  const imageOnly = await listInboundMmsD1EligiblePendingJobs(input, deps);
  if (imageOnly === "error") return EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT;

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
      candidate: buildInboundMmsD1CandidateFact(job, now),
      recent_wins: [],
    };
  }

  const winIds = winsListed.map((w) => w.id);
  const withMedia = await listWinIdsWithMedia({ clerkUserId, winIds });
  const mediaSet = withMedia === "error" ? new Set<string>() : withMedia;

  const recent_wins: InboundMmsD1RecentWin[] = winsListed.map((w) => ({
    id: w.id,
    text: conciseWinText(w),
    occurred_at: w.occurred_at,
    relationship_type: w.relationship_type,
    commitment_id: w.commitment_id,
    has_media: mediaSet.has(w.id),
  }));

  return {
    candidate_count: 1,
    candidate: buildInboundMmsD1CandidateFact(job, now),
    recent_wins,
  };
}

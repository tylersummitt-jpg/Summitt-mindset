/**
 * Internal pending-photo target on v2_user_sms_comms_preferences.
 * Slice 1: read + narrow clear. Slice 2: eligibility read + post-send write.
 * Not PATCH, not STOP/START, not SMS copy. UUID never goes to Sol/writer.
 */

import "server-only";

import { INBOUND_BURST_COALESCE_WINDOW_MS } from "@/lib/sms-inbound-burst-pace";
import { supabaseServer } from "@/lib/supabase-server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasNonEmptyText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export const INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES = [
  "reply_ready",
  "sending",
  "sent",
  "cancelled",
  "awaiting_manual_pat_answer",
] as const;

export const INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO = [
  "pending",
  "processing",
  "failed",
  "needs_manual_review",
  "generating_reply",
] as const;

export type InboundPhotoRequestCoachFallbackStatus =
  | (typeof INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES)[number]
  | (typeof INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO)[number];

export const INBOUND_PHOTO_REQUEST_PENDING_TTL_MS = 6 * 60 * 60 * 1000;
export const INBOUND_PHOTO_REQUEST_COOLDOWN_MS = 168 * 60 * 60 * 1000;

export type ActivePendingPhotoTarget = {
  winId: string;
  expiresAt: string;
};

export type PhotoRequestEligibilityState = {
  pending: ActivePendingPhotoTarget | null;
  lastSentAt: string | null;
};

export type PersistWinLiteForPhotoTarget = {
  id: string | null;
  status: string;
};

export function isInboundPhotoRequestCoachFallbackAllowed(
  status: string | null | undefined
): boolean {
  if (!hasNonEmptyText(status)) return false;
  return (INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES as readonly string[]).includes(
    status.trim()
  );
}

export function isActivePendingPhotoTarget(
  row: {
    pending_photo_request_win_id?: string | null;
    pending_photo_request_expires_at?: string | null;
  } | null,
  now: Date
): row is {
  pending_photo_request_win_id: string;
  pending_photo_request_expires_at: string;
} {
  if (!row) return false;
  const winId = row.pending_photo_request_win_id?.trim() ?? "";
  if (!winId || !UUID_RE.test(winId)) return false;
  const expiresRaw = row.pending_photo_request_expires_at?.trim() ?? "";
  if (!expiresRaw) return false;
  const expires = new Date(expiresRaw).getTime();
  if (!Number.isFinite(expires)) return false;
  return expires > now.getTime();
}

export async function loadActivePendingPhotoTarget(
  clerkUserId: string,
  now: Date = new Date()
): Promise<ActivePendingPhotoTarget | null | "error"> {
  const clerk = clerkUserId.trim();
  if (!clerk) return null;
  try {
    const { data, error } = await supabaseServer
      .from("v2_user_sms_comms_preferences")
      .select(
        "pending_photo_request_win_id, pending_photo_request_expires_at, last_photo_request_sent_at"
      )
      .eq("clerk_user_id", clerk)
      .maybeSingle();
    if (error) {
      console.warn("[inbound-photo-request] pending_read_failed", {
        message: error.message.slice(0, 120),
      });
      return "error";
    }
    if (!isActivePendingPhotoTarget(data, now)) return null;
    return {
      winId: data.pending_photo_request_win_id.trim(),
      expiresAt: data.pending_photo_request_expires_at.trim(),
    };
  } catch (e) {
    console.warn("[inbound-photo-request] pending_read_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return "error";
  }
}

/**
 * Same-SID coach job status for body+photo pending fallback.
 * Missing row → null. Query failure → "error". Both are NO-fallback.
 */
export async function loadCoachJobStatusForPhotoPendingFallback(
  messageSid: string
): Promise<string | null | "error"> {
  const sid = messageSid.trim();
  if (!sid) return "error";
  try {
    const { data, error } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .select("status")
      .eq("message_sid", sid)
      .maybeSingle();
    if (error) {
      console.warn("[inbound-photo-request] coach_status_read_failed", {
        message: error.message.slice(0, 120),
      });
      return "error";
    }
    if (!data || typeof (data as { status?: unknown }).status !== "string") {
      return null;
    }
    const status = String((data as { status: string }).status).trim();
    return status || null;
  } catch (e) {
    console.warn("[inbound-photo-request] coach_status_read_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return "error";
  }
}

/**
 * Clear pending target only. Never touches last_photo_request_sent_at.
 */
export async function clearPendingPhotoRequestTarget(args: {
  clerkUserId: string;
  winId: string;
  now?: Date;
}): Promise<boolean> {
  const clerkUserId = args.clerkUserId.trim();
  const winId = args.winId.trim();
  if (!clerkUserId || !UUID_RE.test(winId)) return false;
  const nowIso = (args.now ?? new Date()).toISOString();
  try {
    const { data, error } = await supabaseServer
      .from("v2_user_sms_comms_preferences")
      .update({
        pending_photo_request_win_id: null,
        pending_photo_request_expires_at: null,
        updated_at: nowIso,
      })
      .eq("clerk_user_id", clerkUserId)
      .eq("pending_photo_request_win_id", winId)
      .select("clerk_user_id")
      .maybeSingle();
    if (error) {
      console.warn("[inbound-photo-request] pending_clear_failed", {
        message: error.message.slice(0, 120),
      });
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("[inbound-photo-request] pending_clear_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return false;
  }
}

function lastSentAtFromRow(
  row: { last_photo_request_sent_at?: string | null } | null
): string | null {
  const raw = row?.last_photo_request_sent_at;
  if (!hasNonEmptyText(raw)) return null;
  return raw.trim();
}

/** Exactly one freshly inserted win with a nonempty UUID. Else null. */
export function candidatePhotoTargetWinIdFromPersistResult(
  wins: PersistWinLiteForPhotoTarget[] | null | undefined
): string | null {
  if (!Array.isArray(wins)) return null;
  const inserted = wins.filter((w) => {
    if (w.status !== "inserted") return false;
    const id = typeof w.id === "string" ? w.id.trim() : "";
    return !!id && UUID_RE.test(id);
  });
  if (inserted.length !== 1) return null;
  const id = inserted[0]?.id?.trim() ?? "";
  return id || null;
}

export function isPhotoRequestCooldownClear(
  lastSentAt: string | null | undefined,
  now: Date
): boolean {
  if (!hasNonEmptyText(lastSentAt)) return true;
  const t = new Date(lastSentAt.trim()).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t >= INBOUND_PHOTO_REQUEST_COOLDOWN_MS;
}

export function computePhotoRequestAllowed(args: {
  candidateWinId: string | null;
  questionPolicy: string | null | undefined;
  hasCurrentTurnMedia: boolean | "error";
  eligibilityState: PhotoRequestEligibilityState | "error";
  now: Date;
  /** Explicit Goal Change / temporary confirmation already owns the question. */
  bindingConfirmationRequired?: boolean;
}): boolean {
  if (!args.candidateWinId || !UUID_RE.test(args.candidateWinId)) return false;
  if (args.questionPolicy !== "none") return false;
  if (args.bindingConfirmationRequired === true) return false;
  if (args.hasCurrentTurnMedia !== false) return false;
  if (args.eligibilityState === "error") return false;
  if (args.eligibilityState.pending) return false;
  if (!isPhotoRequestCooldownClear(args.eligibilityState.lastSentAt, args.now)) {
    return false;
  }
  return true;
}

export function shouldWritePhotoRequestAfterSuccessfulSend(args: {
  photoRequested: boolean;
  candidatePhotoTargetWinId: string | null | undefined;
}): boolean {
  const winId = args.candidatePhotoTargetWinId?.trim() ?? "";
  return args.photoRequested === true && UUID_RE.test(winId);
}

export async function loadPhotoRequestEligibilityState(
  clerkUserId: string,
  now: Date = new Date()
): Promise<PhotoRequestEligibilityState | "error"> {
  const clerk = clerkUserId.trim();
  if (!clerk) return "error";
  try {
    const { data, error } = await supabaseServer
      .from("v2_user_sms_comms_preferences")
      .select(
        "pending_photo_request_win_id, pending_photo_request_expires_at, last_photo_request_sent_at"
      )
      .eq("clerk_user_id", clerk)
      .maybeSingle();
    if (error) {
      console.warn("[inbound-photo-request] eligibility_read_failed", {
        message: error.message.slice(0, 120),
      });
      return "error";
    }
    const pending = isActivePendingPhotoTarget(data, now)
      ? {
          winId: data.pending_photo_request_win_id.trim(),
          expiresAt: data.pending_photo_request_expires_at.trim(),
        }
      : null;
    return { pending, lastSentAt: lastSentAtFromRow(data) };
  } catch (e) {
    console.warn("[inbound-photo-request] eligibility_read_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return "error";
  }
}

function uniqueTrimmedMessageSids(sids: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of sids ?? []) {
    const sid = raw.trim();
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    out.push(sid);
  }
  return out;
}

/**
 * Occupancy window for image-only-then-caption: media.created_at in
 * (turnReceivedAt - coalesce 120s, turnReceivedAt]. Anchored to the processed
 * coach job's created_at, not worker now (quiet would shrink the lookback).
 */
export function photoRequestRecentMediaWindow(turnReceivedAt: Date): {
  startIso: string;
  endIso: string;
} | null {
  const endMs = turnReceivedAt.getTime();
  if (!Number.isFinite(endMs)) return null;
  return {
    startIso: new Date(endMs - INBOUND_BURST_COALESCE_WINDOW_MS).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/**
 * Current-turn media-job occupancy. Any inbound media job on a coalesced SID,
 * or any media job for this clerk created in the 120s immediately before the
 * processed turn, means the member already sent a picture.
 * Query error → "error" (fail closed for photo ask).
 */
export async function hasCurrentTurnInboundMediaOccupancy(args: {
  clerkUserId: string;
  currentTurnMessageSids: readonly string[];
  turnReceivedAt: Date;
}): Promise<boolean | "error"> {
  const clerk = args.clerkUserId.trim();
  if (!clerk) return "error";
  const sids = uniqueTrimmedMessageSids(args.currentTurnMessageSids);
  try {
    if (sids.length > 0) {
      const { data, error } = await supabaseServer
        .from("v2_inbound_media_job")
        .select("id")
        .eq("clerk_user_id", clerk)
        .in("message_sid", sids)
        .limit(2);
      if (error) {
        console.warn("[inbound-photo-request] current_turn_media_read_failed", {
          message: error.message.slice(0, 120),
        });
        return "error";
      }
      if (Array.isArray(data) && data.length > 0) return true;
    }

    const window = photoRequestRecentMediaWindow(args.turnReceivedAt);
    if (!window) return "error";
    const { data, error } = await supabaseServer
      .from("v2_inbound_media_job")
      .select("id")
      .eq("clerk_user_id", clerk)
      .gte("created_at", window.startIso)
      .lte("created_at", window.endIso)
      .limit(2);
    if (error) {
      console.warn("[inbound-photo-request] recent_media_window_read_failed", {
        message: error.message.slice(0, 120),
      });
      return "error";
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.length > 0;
  } catch (e) {
    console.warn("[inbound-photo-request] current_turn_media_read_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return "error";
  }
}

/**
 * One UPDATE after Twilio success: pending target + 6h TTL + cooldown clock.
 * Never throws. False means the write did not land.
 */
export async function writePendingPhotoRequestAfterSuccessfulSend(args: {
  clerkUserId: string;
  winId: string;
  now?: Date;
}): Promise<boolean> {
  const clerkUserId = args.clerkUserId.trim();
  const winId = args.winId.trim();
  if (!clerkUserId || !UUID_RE.test(winId)) return false;
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + INBOUND_PHOTO_REQUEST_PENDING_TTL_MS
  ).toISOString();
  try {
    const { data, error } = await supabaseServer
      .from("v2_user_sms_comms_preferences")
      .update({
        pending_photo_request_win_id: winId,
        pending_photo_request_expires_at: expiresAt,
        last_photo_request_sent_at: nowIso,
        updated_at: nowIso,
      })
      .eq("clerk_user_id", clerkUserId)
      .select("clerk_user_id")
      .maybeSingle();
    if (error) {
      console.warn("[inbound-photo-request] pending_write_failed", {
        message: error.message.slice(0, 120),
      });
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("[inbound-photo-request] pending_write_failed", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return false;
  }
}

/** Fail-soft post-Twilio seam. Never throws. Never retries Twilio. */
export async function tryWritePhotoRequestStateAfterTwilioSuccess(args: {
  clerkUserId: string;
  photoRequested: boolean;
  candidatePhotoTargetWinId: string | null | undefined;
  now?: Date;
}): Promise<void> {
  if (
    !shouldWritePhotoRequestAfterSuccessfulSend({
      photoRequested: args.photoRequested,
      candidatePhotoTargetWinId: args.candidatePhotoTargetWinId,
    })
  ) {
    return;
  }
  try {
    const winId = args.candidatePhotoTargetWinId?.trim() ?? "";
    const ok = await writePendingPhotoRequestAfterSuccessfulSend({
      clerkUserId: args.clerkUserId,
      winId,
      now: args.now,
    });
    if (!ok) {
      console.warn("[inbound-photo-request] pending_write_failed_soft", {
        clerk_user_id_present: !!args.clerkUserId.trim(),
      });
    }
  } catch (e) {
    console.warn("[inbound-photo-request] pending_write_failed_soft", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
  }
}

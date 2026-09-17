/**
 * Slice 1 — internal pending-photo target on v2_user_sms_comms_preferences.
 * Read + narrow clear only. Not PATCH, not STOP/START, not writer, not SMS copy.
 */

import "server-only";

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

export type ActivePendingPhotoTarget = {
  winId: string;
  expiresAt: string;
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

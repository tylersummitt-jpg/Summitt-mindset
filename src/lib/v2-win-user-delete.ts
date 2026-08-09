/**
 * Item #5 — user Delete Win (Victory Room soft-hide).
 * Does not physically delete v2_win. Does not touch accountability, SMS, or revisions.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/** Stable internal hide reason — never shown in UI. Distinct from system supersede hides. */
export const USER_WIN_DELETE_HIDDEN_REASON = "user_deleted" as const;

export type UserWinDeleteErrorCode =
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "persist_failed";

export type DeleteUserVictoryWinResult =
  | { ok: true; win_id: string }
  | { ok: false; error: string; code: UserWinDeleteErrorCode };

const UI_NOT_FOUND = "Win not found.";
const UI_CONFLICT = "This Win changed since you opened it. Refresh and try again.";
const UI_FAILED = "We couldn’t delete this Win. Please try again.";

/**
 * Soft-hide an owned active Win from Victory Room.
 * Conditional on expected_updated_at. Never reactivates; never deletes the row.
 */
export async function deleteUserVictoryWin(args: {
  clerkUserId: string;
  winId: string;
  expectedUpdatedAt: unknown;
}): Promise<DeleteUserVictoryWinResult> {
  const clerk = args.clerkUserId.trim();
  if (!clerk) {
    return { ok: false, error: "Please sign in again.", code: "unauthorized" };
  }

  const winId = typeof args.winId === "string" ? args.winId.trim() : "";
  if (!winId) {
    return { ok: false, error: UI_NOT_FOUND, code: "not_found" };
  }

  const expectedUpdatedAt =
    typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt.trim() : "";
  if (!expectedUpdatedAt) {
    return { ok: false, error: UI_CONFLICT, code: "conflict" };
  }

  const hiddenAt = new Date().toISOString();

  const { data, error } = await supabaseServer
    .from("v2_win")
    .update({
      status: "hidden",
      hidden_at: hiddenAt,
      hidden_reason: USER_WIN_DELETE_HIDDEN_REASON,
    })
    .eq("id", winId)
    .eq("clerk_user_id", clerk)
    .eq("status", "active")
    .eq("updated_at", expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[user_win_delete_failed]", {
      code: error.code ?? null,
      message: error.message?.slice(0, 120) ?? "unknown",
    });
    return { ok: false, error: UI_FAILED, code: "persist_failed" };
  }

  if (data?.id) {
    return {
      ok: true,
      win_id: typeof data.id === "string" ? data.id : String(data.id),
    };
  }

  // Zero rows: classify missing/foreign/hidden vs stale concurrency.
  const { data: existing, error: readErr } = await supabaseServer
    .from("v2_win")
    .select("id, clerk_user_id, status, updated_at")
    .eq("id", winId)
    .maybeSingle();

  if (readErr) {
    console.warn("[user_win_delete_failed]", {
      code: readErr.code ?? null,
      message: readErr.message?.slice(0, 120) ?? "unknown",
    });
    return { ok: false, error: UI_FAILED, code: "persist_failed" };
  }

  if (
    !existing ||
    typeof existing.id !== "string" ||
    existing.clerk_user_id !== clerk ||
    existing.status !== "active"
  ) {
    return { ok: false, error: UI_NOT_FOUND, code: "not_found" };
  }

  if (existing.updated_at !== expectedUpdatedAt) {
    return { ok: false, error: UI_CONFLICT, code: "conflict" };
  }

  // Active + matching token but update matched nothing (race) — treat as conflict.
  return { ok: false, error: UI_CONFLICT, code: "conflict" };
}

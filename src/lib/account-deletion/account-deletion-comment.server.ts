/**
 * Best-effort calls for opted-in deletion notes.
 * Contract: 2026-11-05-deletion-comment-v1.
 * Missing objects and RPC failures are logged by code only and swallowed.
 * These functions do not write account_deletion_requests.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  ACCOUNT_DELETION_COMMENT_SETTLE_LIMIT,
  RECORD_ACCOUNT_DELETION_COMMENT_RPC,
  SETTLE_ACCOUNT_DELETION_COMMENTS_RPC,
} from "@/lib/account-deletion/account-deletion-comment-contract";

export type DeletionComment = {
  retainedOn: string;
  message: string;
};

export type DeletionCommentView =
  | { status: "ready"; comments: DeletionComment[]; capped: boolean }
  | { status: "empty" }
  | { status: "unavailable" };

const COMMENT_LIMIT = 40;

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "deletion_comment_failed";
}

export async function recordAccountDeletionComment(
  clerkUserId: string,
  message: string
): Promise<void> {
  try {
    const result = await supabaseServer.rpc(RECORD_ACCOUNT_DELETION_COMMENT_RPC, {
      p_clerk_user_id: clerkUserId,
      p_message: message,
    });
    if (result?.error) {
      console.warn("[account-deletion] comment record failed", { code: errorCode(result.error) });
    }
  } catch (err) {
    console.warn("[account-deletion] comment record failed", {
      code: err instanceof Error ? err.name : "deletion_comment_failed",
    });
  }
}

export async function settleAccountDeletionComments(): Promise<void> {
  try {
    const result = await supabaseServer.rpc(SETTLE_ACCOUNT_DELETION_COMMENTS_RPC, {
      p_limit: ACCOUNT_DELETION_COMMENT_SETTLE_LIMIT,
    });
    if (result?.error) {
      console.warn("[account-deletion] comment settle failed", { code: errorCode(result.error) });
    }
  } catch (err) {
    console.warn("[account-deletion] comment settle failed", {
      code: err instanceof Error ? err.name : "deletion_comment_failed",
    });
  }
}

export async function loadDeletionComments(): Promise<DeletionCommentView> {
  try {
    const { data, error } = await supabaseServer
      .from("account_deletion_comments")
      .select("retained_at, message")
      .order("retained_at", { ascending: false })
      .limit(COMMENT_LIMIT + 1);
    if (error) {
      console.warn("[retention] deletion comments read failed", { code: errorCode(error) });
      return { status: "unavailable" };
    }
    const comments: DeletionComment[] = [];
    for (const row of data ?? []) {
      if (!row || typeof row !== "object") continue;
      const record = row as { message?: unknown; retained_at?: unknown };
      if (typeof record.message !== "string") continue;
      const message = record.message.trim();
      if (!message) continue;
      comments.push({
        retainedOn:
          typeof record.retained_at === "string" ? record.retained_at.slice(0, 10) : "Date unavailable",
        message: message.slice(0, 2000),
      });
    }
    const capped = comments.length > COMMENT_LIMIT;
    const visible = comments.slice(0, COMMENT_LIMIT);
    if (visible.length === 0) return { status: "empty" };
    return { status: "ready", comments: visible, capped };
  } catch (err) {
    console.warn("[retention] deletion comments read failed", {
      code: err instanceof Error ? err.name : "deletion_comment_failed",
    });
    return { status: "unavailable" };
  }
}

/**
 * Browser-safe deletion-comment contract.
 * The delete request stays `{ confirmation: "DELETE" }`.
 * A written note is sent only after the member chooses to keep it.
 */

export const ACCOUNT_DELETION_COMMENT_POST_PATH = "/api/account/delete-comment" as const;

export const ACCOUNT_DELETION_COMMENT_SQL_CONTRACT = "2026-11-05-deletion-comment-v1" as const;

export const RECORD_ACCOUNT_DELETION_COMMENT_RPC = "record_account_deletion_comment" as const;

export const SETTLE_ACCOUNT_DELETION_COMMENTS_RPC = "settle_account_deletion_comments" as const;

export const ACCOUNT_DELETION_COMMENT_SETTLE_LIMIT = 25 as const;

export const ACCOUNT_DELETION_COMMENT_MAX = 2000 as const;

export const ACCOUNT_DELETION_COMMENT_DISCLOSURE =
  "What you write is optional. We keep it after your account is deleted only if you choose Keep this note. Do not include your name, email, phone number, or other details that identify you. Deleting your account does not make this note anonymous. Skipping does not affect deleting your account." as const;

export const ACCOUNT_DELETION_COMMENT_RETAIN_LABEL =
  "Keep this note after my account is deleted." as const;

export function buildAccountDeletionCommentRequestBody(message: string): {
  message: string;
  retain: true;
} {
  return { message, retain: true };
}

/** Exactly `{ message, retain: true }`. Any other shape is rejected. */
export function validateAccountDeletionCommentBody(
  body: unknown
): { ok: true; message: string } | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "message" || keys[1] !== "retain") {
    return { ok: false };
  }
  if (record.retain !== true || typeof record.message !== "string") {
    return { ok: false };
  }
  const message = record.message.trim();
  if (message.length < 1 || message.length > ACCOUNT_DELETION_COMMENT_MAX) {
    return { ok: false };
  }
  return { ok: true, message };
}

/**
 * Start the comment request only when the member chose to keep a note.
 * Do not wait for it. Failures are ignored.
 */
export function sendAccountDeletionComment(message: string, retain: boolean): void {
  if (!retain) return;
  const parsed = validateAccountDeletionCommentBody(
    buildAccountDeletionCommentRequestBody(message.trim())
  );
  if (!parsed.ok) return;
  try {
    void fetch(ACCOUNT_DELETION_COMMENT_POST_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(buildAccountDeletionCommentRequestBody(parsed.message)),
    }).catch(() => undefined);
  } catch {
    // A closed page or a missing fetch must not surface as a deletion error.
  }
}

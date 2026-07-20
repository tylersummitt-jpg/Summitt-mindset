/**
 * Browser-safe account-deletion initiation contract.
 *
 * Shared by the server initiation core and the client Danger Zone UI.
 * Must never import "server-only", repository, Supabase, or Clerk server APIs.
 * Must never read environment variables or call external services.
 */

export const ACCOUNT_DELETION_CONFIRMATION_VALUE = "DELETE" as const;

export const ACCOUNT_DELETION_INITIATION_DISABLED_CODE =
  "account_deletion_initiation_disabled" as const;

export const ACCOUNT_DELETION_POST_PATH = "/api/account/delete" as const;

/** Complete sanitized initiation response-code union (wire contract). */
export const ACCOUNT_DELETION_INITIATION_CODES = [
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  "unauthorized",
  "reauth_required",
  "reauth_unavailable",
  "invalid_confirmation",
  "accepted_new",
  "accepted_existing",
  "already_completed",
  "failed_terminal",
  "conflict",
  "internal_error",
] as const;

export type AccountDeletionInitiationCode =
  (typeof ACCOUNT_DELETION_INITIATION_CODES)[number];

export type AccountDeletionInitiationBody = {
  ok: boolean;
  code: AccountDeletionInitiationCode;
};

export function isAccountDeletionInitiationCode(
  value: unknown
): value is AccountDeletionInitiationCode {
  return (
    typeof value === "string" &&
    (ACCOUNT_DELETION_INITIATION_CODES as readonly string[]).includes(value)
  );
}

/**
 * Validate confirmation body: exactly `{ confirmation: "DELETE" }`.
 * No trim, no case folding, no extra keys, no coercion.
 */
export function validateAccountDeletionConfirmation(
  body: unknown
): { ok: true } | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== "confirmation") {
    return { ok: false };
  }
  if (obj.confirmation !== ACCOUNT_DELETION_CONFIRMATION_VALUE) {
    return { ok: false };
  }
  return { ok: true };
}

/** Exact client POST body — confirmation only; no identity fields. */
export function buildAccountDeletionInitiationRequestBody(): {
  confirmation: typeof ACCOUNT_DELETION_CONFIRMATION_VALUE;
} {
  return { confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE };
}

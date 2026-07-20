/**
 * APP-041F2 — injectable account-deletion initiation core.
 *
 * Fail-closed order (testable):
 * 1. authenticated user id present
 * 2. dual exact-string flags (initiation AND scheduler)
 * 3. confirmation body === exact "DELETE"
 * 4. reauthentication verifier
 * 5. create-or-get durable request
 * 6. sanitize response (ok + code only)
 *
 * Does not read environment. Does not construct providers.
 * Does not call SMS/Stripe/purge/Clerk/reconciler/lease APIs.
 */

import "server-only";

export const ACCOUNT_DELETION_INITIATION_ENABLED_ENV =
  "ACCOUNT_DELETION_INITIATION_ENABLED" as const;

export const ACCOUNT_DELETION_INITIATION_DISABLED_CODE =
  "account_deletion_initiation_disabled" as const;

export const ACCOUNT_DELETION_CONFIRMATION_VALUE = "DELETE" as const;

/** Exact-string: only the literal "true" enables a flag. */
export function isExactTrueFlag(raw: string | undefined | null): boolean {
  return raw === "true";
}

/** Dual hard gate: both flags must be exactly "true". */
export function isAccountDeletionInitiationFullyEnabled(
  initiationRaw: string | undefined | null,
  schedulerRaw: string | undefined | null
): boolean {
  return isExactTrueFlag(initiationRaw) && isExactTrueFlag(schedulerRaw);
}

export type AccountDeletionInitiationCode =
  | typeof ACCOUNT_DELETION_INITIATION_DISABLED_CODE
  | "unauthorized"
  | "reauth_required"
  | "reauth_unavailable"
  | "invalid_confirmation"
  | "accepted_new"
  | "accepted_existing"
  | "already_completed"
  | "failed_terminal"
  | "conflict"
  | "internal_error";

export type AccountDeletionInitiationBody = {
  ok: boolean;
  code: AccountDeletionInitiationCode;
};

export type AccountDeletionInitiationResult = {
  httpStatus: number;
  body: AccountDeletionInitiationBody;
};

export type AccountDeletionReauthVerificationResult =
  | { ok: true }
  | { ok: false; code: "reauth_required" | "reauth_unavailable" };

export type AccountDeletionInitiationCreateOutcome =
  | "created_new"
  | "existing_active"
  | "already_completed"
  | "failed_terminal"
  | "conflict"
  | "internal_error";

export type RunAccountDeletionInitiationInput = {
  authenticatedUserId: string | null | undefined;
  confirmationBody: unknown;
  initiationEnabledRaw: string | undefined | null;
  schedulerEnabledRaw: string | undefined | null;
  verifyReauthentication: () => Promise<AccountDeletionReauthVerificationResult>;
  createOrGetRequest: (
    clerkUserId: string
  ) => Promise<AccountDeletionInitiationCreateOutcome>;
};

function response(
  httpStatus: number,
  ok: boolean,
  code: AccountDeletionInitiationCode
): AccountDeletionInitiationResult {
  return { httpStatus, body: { ok, code } };
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

function mapCreateOutcome(
  outcome: AccountDeletionInitiationCreateOutcome
): AccountDeletionInitiationResult {
  switch (outcome) {
    case "created_new":
      return response(200, true, "accepted_new");
    case "existing_active":
      return response(200, true, "accepted_existing");
    case "already_completed":
      return response(409, true, "already_completed");
    case "failed_terminal":
      return response(409, false, "failed_terminal");
    case "conflict":
      return response(409, false, "conflict");
    case "internal_error":
    default:
      return response(500, false, "internal_error");
  }
}

/**
 * One initiation attempt with fail-closed order.
 * Never loops. Never retries. Never calls providers.
 */
export async function runAccountDeletionInitiation(
  input: RunAccountDeletionInitiationInput
): Promise<AccountDeletionInitiationResult> {
  const userId =
    typeof input.authenticatedUserId === "string"
      ? input.authenticatedUserId
      : "";
  if (!userId) {
    return response(401, false, "unauthorized");
  }

  if (
    !isAccountDeletionInitiationFullyEnabled(
      input.initiationEnabledRaw,
      input.schedulerEnabledRaw
    )
  ) {
    return response(503, false, ACCOUNT_DELETION_INITIATION_DISABLED_CODE);
  }

  if (!validateAccountDeletionConfirmation(input.confirmationBody).ok) {
    return response(400, false, "invalid_confirmation");
  }

  let reauth: AccountDeletionReauthVerificationResult;
  try {
    reauth = await input.verifyReauthentication();
  } catch {
    return response(403, false, "reauth_unavailable");
  }
  if (!reauth || typeof reauth !== "object" || reauth.ok !== true) {
    const code =
      reauth &&
      typeof reauth === "object" &&
      "code" in reauth &&
      reauth.code === "reauth_unavailable"
        ? "reauth_unavailable"
        : "reauth_required";
    return response(403, false, code);
  }

  let outcome: AccountDeletionInitiationCreateOutcome;
  try {
    outcome = await input.createOrGetRequest(userId);
  } catch {
    return response(500, false, "internal_error");
  }

  if (typeof outcome !== "string") {
    return response(500, false, "internal_error");
  }
  return mapCreateOutcome(outcome);
}

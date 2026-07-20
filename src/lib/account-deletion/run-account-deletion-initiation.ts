/**
 * APP-041F2 — injectable account-deletion initiation core.
 * APP-041F4b — access uses centralized public / designated-test decision.
 *
 * Fail-closed order (testable):
 * 1. authenticated user id present
 * 2. initiation access (public dual gate OR designated test + scheduler)
 * 3. confirmation body === exact "DELETE"
 * 4. reauthentication verifier
 * 5. create-or-get durable request
 * 6. sanitize response (ok + code only)
 *
 * Does not read environment. Does not construct providers.
 * Does not call SMS/Stripe/purge/Clerk/reconciler/lease APIs.
 *
 * Browser-safe wire constants/types live in
 * account-deletion-initiation-contract.ts (no server-only).
 * Access decision lives in account-deletion-initiation-access.ts.
 */

import "server-only";

import {
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  type AccountDeletionInitiationBody,
  type AccountDeletionInitiationCode,
  validateAccountDeletionConfirmation,
} from "./account-deletion-initiation-contract";
import {
  evaluateAccountDeletionInitiationAccess,
  isAccountDeletionInitiationAccessGranted,
} from "./account-deletion-initiation-access";

export {
  ACCOUNT_DELETION_CONFIRMATION_VALUE,
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  validateAccountDeletionConfirmation,
  type AccountDeletionInitiationBody,
  type AccountDeletionInitiationCode,
} from "./account-deletion-initiation-contract";

export {
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV,
  ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV,
  evaluateAccountDeletionInitiationAccess,
  isAccountDeletionInitiationAccessGranted,
  isAccountDeletionInitiationFullyEnabled,
  isExactTrueFlag,
  type AccountDeletionInitiationAccess,
} from "./account-deletion-initiation-access";

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
  /** APP-041F4b — exact "true" enables designated-test path (with scheduler + ID). */
  testModeEnabledRaw?: string | undefined | null;
  /** APP-041F4b — exact full Clerk user ID; unset/empty = no designated user. */
  designatedTestUserIdRaw?: string | undefined | null;
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

  const access = evaluateAccountDeletionInitiationAccess({
    authenticatedUserId: userId,
    publicInitiationFlag: input.initiationEnabledRaw,
    schedulerFlag: input.schedulerEnabledRaw,
    testModeFlag: input.testModeEnabledRaw,
    designatedTestUserId: input.designatedTestUserIdRaw,
  });
  if (!isAccountDeletionInitiationAccessGranted(access)) {
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

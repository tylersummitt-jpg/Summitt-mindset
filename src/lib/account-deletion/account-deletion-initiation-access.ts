/**
 * APP-041F4b — pure account-deletion initiation access decision.
 *
 * Browser-safe: no env reads, no I/O, no logging, no PII beyond mode enums.
 * Shared by the initiation route and /user Server Component via the
 * server-only adapter (account-deletion-initiation-access.server.ts).
 *
 * Public initiation:
 *   ACCOUNT_DELETION_INITIATION_ENABLED === "true"
 *   AND ACCOUNT_DELETION_SCHEDULER_ENABLED === "true"
 *
 * Designated test initiation (inert until env configured later):
 *   authenticated Clerk user ID exactly equals ACCOUNT_DELETION_TEST_CLERK_USER_ID
 *   AND ACCOUNT_DELETION_TEST_MODE_ENABLED === "true"
 *   AND ACCOUNT_DELETION_SCHEDULER_ENABLED === "true"
 *
 * Exact full-ID match only — no trim, case fold, prefix, list, email, or role.
 */

export const ACCOUNT_DELETION_INITIATION_ENABLED_ENV =
  "ACCOUNT_DELETION_INITIATION_ENABLED" as const;

export const ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV =
  "ACCOUNT_DELETION_SCHEDULER_ENABLED" as const;

export const ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV =
  "ACCOUNT_DELETION_TEST_MODE_ENABLED" as const;

export const ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV =
  "ACCOUNT_DELETION_TEST_CLERK_USER_ID" as const;

/** Exact-string: only the literal "true" enables a flag. */
export function isExactTrueFlag(raw: string | undefined | null): boolean {
  return raw === "true";
}

export type AccountDeletionInitiationAccess =
  | "public_enabled"
  | "designated_test_enabled"
  | "disabled";

export type EvaluateAccountDeletionInitiationAccessInput = {
  authenticatedUserId: string | null | undefined;
  publicInitiationFlag: string | undefined | null;
  schedulerFlag: string | undefined | null;
  testModeFlag: string | undefined | null;
  designatedTestUserId: string | undefined | null;
};

/**
 * Centralized initiation access decision.
 * Public mode wins when both public + scheduler are exact "true".
 * Designated test mode never bypasses scheduler enablement.
 */
export function evaluateAccountDeletionInitiationAccess(
  input: EvaluateAccountDeletionInitiationAccessInput
): AccountDeletionInitiationAccess {
  const schedulerOn = isExactTrueFlag(input.schedulerFlag);

  if (schedulerOn && isExactTrueFlag(input.publicInitiationFlag)) {
    return "public_enabled";
  }

  const userId =
    typeof input.authenticatedUserId === "string"
      ? input.authenticatedUserId
      : "";
  const designated =
    typeof input.designatedTestUserId === "string"
      ? input.designatedTestUserId
      : "";

  if (
    schedulerOn &&
    isExactTrueFlag(input.testModeFlag) &&
    userId !== "" &&
    designated !== "" &&
    userId === designated
  ) {
    return "designated_test_enabled";
  }

  return "disabled";
}

/** True when Danger Zone / initiation mutation path may proceed. */
export function isAccountDeletionInitiationAccessGranted(
  access: AccountDeletionInitiationAccess
): boolean {
  return access === "public_enabled" || access === "designated_test_enabled";
}

/**
 * Public dual gate only (test allowlist ignored).
 * Kept for callers that intentionally mean public-only enablement.
 */
export function isAccountDeletionInitiationFullyEnabled(
  initiationRaw: string | undefined | null,
  schedulerRaw: string | undefined | null
): boolean {
  return (
    evaluateAccountDeletionInitiationAccess({
      authenticatedUserId: null,
      publicInitiationFlag: initiationRaw,
      schedulerFlag: schedulerRaw,
      testModeFlag: null,
      designatedTestUserId: null,
    }) === "public_enabled"
  );
}

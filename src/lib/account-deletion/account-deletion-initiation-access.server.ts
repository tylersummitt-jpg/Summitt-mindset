/**
 * APP-041F4b — server-only env adapter for initiation access.
 *
 * Reads raw flag/allowlist env values and evaluates the pure access helper.
 * Never logs configured IDs. Never returns raw env strings to callers that
 * render HTML — use shouldShowAccountDeletionDangerZone / resolveAccess only.
 */

import "server-only";

import {
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV,
  ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV,
  ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV,
  evaluateAccountDeletionInitiationAccess,
  isAccountDeletionInitiationAccessGranted,
  type AccountDeletionInitiationAccess,
  type EvaluateAccountDeletionInitiationAccessInput,
} from "./account-deletion-initiation-access";

export {
  isAccountDeletionInitiationAccessGranted,
  type AccountDeletionInitiationAccess,
};

export type AccountDeletionInitiationAccessEnv = Pick<
  EvaluateAccountDeletionInitiationAccessInput,
  | "publicInitiationFlag"
  | "schedulerFlag"
  | "testModeFlag"
  | "designatedTestUserId"
>;

/** Raw env snapshot for injectable cores / route → never serialize to client. */
export function readAccountDeletionInitiationAccessEnv(): AccountDeletionInitiationAccessEnv {
  return {
    publicInitiationFlag:
      process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV],
    schedulerFlag: process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV],
    testModeFlag: process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV],
    designatedTestUserId:
      process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV],
  };
}

export function resolveAccountDeletionInitiationAccess(
  authenticatedUserId: string | null | undefined
): AccountDeletionInitiationAccess {
  const env = readAccountDeletionInitiationAccessEnv();
  return evaluateAccountDeletionInitiationAccess({
    authenticatedUserId,
    ...env,
  });
}

/** /user Server Component: render Danger Zone or null — no mode/ID props. */
export function shouldShowAccountDeletionDangerZone(
  authenticatedUserId: string | null | undefined
): boolean {
  return isAccountDeletionInitiationAccessGranted(
    resolveAccountDeletionInitiationAccess(authenticatedUserId)
  );
}

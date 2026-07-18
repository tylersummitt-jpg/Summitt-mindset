import type { AccountDeletionStatus } from "./types";

/** Forward happy-path edges (processing → milestone). */
const FORWARD_EDGES: ReadonlyArray<readonly [AccountDeletionStatus, AccountDeletionStatus]> =
  [
    ["requested", "suppressing_sms"],
    ["suppressing_sms", "sms_suppressed"],
    ["sms_suppressed", "canceling_subscription"],
    ["canceling_subscription", "subscription_canceled"],
    ["subscription_canceled", "purging_app_data"],
    ["purging_app_data", "app_data_purged"],
    ["app_data_purged", "deleting_clerk"],
    ["deleting_clerk", "completed"],
  ];

const FORWARD = new Map<AccountDeletionStatus, AccountDeletionStatus>(
  FORWARD_EDGES.map(([from, to]) => [from, to])
);

const PROCESSING: ReadonlySet<AccountDeletionStatus> = new Set([
  "suppressing_sms",
  "canceling_subscription",
  "purging_app_data",
  "deleting_clerk",
]);

const CAN_FAIL: ReadonlySet<AccountDeletionStatus> = new Set([
  "requested",
  "suppressing_sms",
  "sms_suppressed",
  "canceling_subscription",
  "subscription_canceled",
  "purging_app_data",
  "app_data_purged",
  "deleting_clerk",
]);

/**
 * Returns true if `from` → `to` is a legal single transition.
 *
 * Resume from `failed_retryable` is allowed only to the persisted
 * `current_step` on the row (passed as `persistedCurrentStep`). Callers
 * cannot invent a later processing target.
 */
export function isLegalAccountDeletionTransition(
  from: AccountDeletionStatus,
  to: AccountDeletionStatus,
  options?: { persistedCurrentStep?: AccountDeletionStatus }
): boolean {
  if (from === to) return false;

  if (to === "failed_retryable" || to === "failed_terminal") {
    return CAN_FAIL.has(from) && from !== "completed" && from !== "failed_terminal";
  }

  if (from === "failed_retryable") {
    const step = options?.persistedCurrentStep;
    if (!step || !PROCESSING.has(step) || step !== to) return false;
    return true;
  }

  if (from === "failed_terminal" || from === "completed") {
    return false;
  }

  return FORWARD.get(from) === to;
}

export function nextForwardAccountDeletionStatus(
  from: AccountDeletionStatus
): AccountDeletionStatus | null {
  return FORWARD.get(from) ?? null;
}

export function isProcessingAccountDeletionStatus(
  status: AccountDeletionStatus
): boolean {
  return PROCESSING.has(status);
}

/**
 * APP-041E3a — trusted scheduler-facing stage wrappers (server-only).
 *
 * These factories require explicit dependencies and never construct live
 * Stripe/Supabase/Clerk clients from environment. They are unreachable from
 * routes/cron until a later slice wires them under a kill switch.
 *
 * Future production/scheduler callers must compose these into
 * createProductionAccountDeletionReconcilerDependencies / executeTrusted…
 * Do not call lower-level orchestrators with ambient defaults from a scheduler.
 */

import "server-only";

import {
  cancelStripeSubscriptionsForDeletion,
  type CancelStripeSubscriptionsForDeletionInput,
  type CancelStripeSubscriptionsForDeletionValue,
  type DeletionStripeClient,
} from "./cancel-subscription";
import {
  orchestrateAppDataPurge,
  type OrchestrateAppDataPurgeInput,
  type OrchestrateAppDataPurgeValue,
} from "./orchestrate-app-data-purge";
import type {
  PurgeAppDataForDeletionInput,
  PurgeAppDataForDeletionValue,
} from "./purge-app-data";
import type { AccountDeletionRepoResult } from "./repository";
import {
  suppressSmsForDeletion,
  type ClearClerkDeletionMetadataFn,
  type SuppressSmsDataFn,
  type SuppressSmsForDeletionInput,
  type SuppressSmsForDeletionValue,
} from "./suppress-sms";

export type TrustedSmsDeletionDependencies = {
  suppressSmsData: SuppressSmsDataFn;
  clearClerkDeletionMetadata: ClearClerkDeletionMetadataFn;
};

export type TrustedCancelStripeDependencies = {
  stripe: DeletionStripeClient;
  recognizedPriceIds: Set<string>;
  getPublicMetadata: NonNullable<
    CancelStripeSubscriptionsForDeletionInput["getPublicMetadata"]
  >;
};

export type TrustedPurgeAppDataDependencies = {
  purgeFn: (
    input: PurgeAppDataForDeletionInput
  ) => Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>>;
};

/**
 * Scheduler-safe SMS stage: requires explicit RPC + metadata deps.
 * Does not construct Supabase or Clerk clients.
 */
export function createTrustedSmsDeletionStage(
  deps: TrustedSmsDeletionDependencies
): (
  input: SuppressSmsForDeletionInput
) => Promise<AccountDeletionRepoResult<SuppressSmsForDeletionValue>> {
  if (!deps || typeof deps !== "object") {
    throw new Error("invalid_sms_deletion_dependencies");
  }
  if (typeof deps.suppressSmsData !== "function") {
    throw new Error("invalid_sms_deletion_dependencies");
  }
  if (typeof deps.clearClerkDeletionMetadata !== "function") {
    throw new Error("invalid_sms_deletion_dependencies");
  }

  const suppressSmsData = deps.suppressSmsData;
  const clearClerkDeletionMetadata = deps.clearClerkDeletionMetadata;

  return (input) =>
    suppressSmsForDeletion({
      ...input,
      suppressSmsData,
      clearClerkDeletionMetadata,
    });
}

/**
 * Scheduler-safe Stripe stage: requires explicit client + price ids + metadata.
 * Never constructs ambient Stripe clients from secrets.
 */
export function createTrustedCancelStripeStage(
  deps: TrustedCancelStripeDependencies
): (
  input: CancelStripeSubscriptionsForDeletionInput
) => Promise<
  AccountDeletionRepoResult<CancelStripeSubscriptionsForDeletionValue>
> {
  if (!deps || typeof deps !== "object") {
    throw new Error("invalid_stripe_deletion_dependencies");
  }
  if (!deps.stripe || typeof deps.stripe !== "object") {
    throw new Error("invalid_stripe_deletion_dependencies");
  }
  if (
    !deps.stripe.customers ||
    typeof deps.stripe.customers.retrieve !== "function" ||
    !deps.stripe.subscriptions ||
    typeof deps.stripe.subscriptions.retrieve !== "function" ||
    typeof deps.stripe.subscriptions.list !== "function" ||
    typeof deps.stripe.subscriptions.cancel !== "function"
  ) {
    throw new Error("invalid_stripe_deletion_dependencies");
  }
  if (
    !(deps.recognizedPriceIds instanceof Set) ||
    deps.recognizedPriceIds.size < 1
  ) {
    throw new Error("invalid_stripe_deletion_dependencies");
  }
  if (typeof deps.getPublicMetadata !== "function") {
    throw new Error("invalid_stripe_deletion_dependencies");
  }

  const stripe = deps.stripe;
  const recognizedPriceIds = deps.recognizedPriceIds;
  const getPublicMetadata = deps.getPublicMetadata;

  return (input) =>
    cancelStripeSubscriptionsForDeletion({
      ...input,
      stripe,
      recognizedPriceIds,
      getPublicMetadata,
    });
}

/**
 * Scheduler-safe purge stage: requires explicit purgeFn.
 * Never defaults to the live purge RPC.
 */
export function createTrustedPurgeAppDataStage(
  deps: TrustedPurgeAppDataDependencies
): (
  input: OrchestrateAppDataPurgeInput
) => Promise<AccountDeletionRepoResult<OrchestrateAppDataPurgeValue>> {
  if (!deps || typeof deps !== "object") {
    throw new Error("invalid_purge_deletion_dependencies");
  }
  if (typeof deps.purgeFn !== "function") {
    throw new Error("invalid_purge_deletion_dependencies");
  }

  const purgeFn = deps.purgeFn;

  return (input) =>
    orchestrateAppDataPurge({
      ...input,
      purgeFn,
    });
}

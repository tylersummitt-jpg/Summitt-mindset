/**
 * APP-041E3a — unreachable production dependency factory (server-only).
 *
 * Builds a frozen AccountDeletionReconcilerDependencies bundle from fully
 * explicit inputs. Kill-switch defaults closed (enabled !== true).
 *
 * Does NOT:
 * - read environment variables
 * - construct Stripe from ambient secrets
 * - call providers
 * - scan/list deletion requests
 * - acquire leases
 * - invoke the reconciler
 * - create routes/cron/UI
 *
 * Future scheduler must pass enabled:true only after the scheduler
 * kill-switch + admin observability gates (later slices). This module remains
 * unreachable from src/app until then.
 *
 * Prefer executeTrustedAccountDeletionReconcile with the returned bundle.
 */

import "server-only";

import {
  createClerkRestDeletionAdapter,
  type CreateClerkRestDeletionAdapterInput,
} from "./clerk-rest-deletion-adapter";
import { orchestrateClerkDeletion } from "./orchestrate-clerk-deletion";
import {
  createTrustedAccountDeletionReconcilerDependencies,
  type AccountDeletionReconcilerDependencies,
} from "./reconcile-account-deletion";
import {
  createTrustedCancelStripeStage,
  createTrustedPurgeAppDataStage,
  createTrustedSmsDeletionStage,
  type TrustedCancelStripeDependencies,
  type TrustedPurgeAppDataDependencies,
  type TrustedSmsDeletionDependencies,
} from "./trusted-account-deletion-stages";

export const PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_DISABLED =
  "account_deletion_production_dependencies_disabled" as const;

export const PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID =
  "invalid_production_account_deletion_dependencies" as const;

export type CreateProductionAccountDeletionReconcilerDependenciesInput = {
  /**
   * Kill switch. Must be exactly true. Missing/false/other → fail closed
   * before any stage or provider construction.
   */
  enabled: boolean;
  sms: TrustedSmsDeletionDependencies;
  stripe: TrustedCancelStripeDependencies["stripe"];
  recognizedPriceIds: TrustedCancelStripeDependencies["recognizedPriceIds"];
  getPublicMetadata: TrustedCancelStripeDependencies["getPublicMetadata"];
  purgeFn: TrustedPurgeAppDataDependencies["purgeFn"];
  clerk: CreateClerkRestDeletionAdapterInput;
};

/**
 * Fail-closed factory for a trusted reconciler dependency bundle.
 * Invokes no stages and no providers; only composes explicit wrappers.
 */
export function createProductionAccountDeletionReconcilerDependencies(
  input: CreateProductionAccountDeletionReconcilerDependenciesInput
): AccountDeletionReconcilerDependencies {
  // Kill switch first — no dependency construction when disabled.
  if (!input || typeof input !== "object" || input.enabled !== true) {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_DISABLED);
  }

  if (!input.sms || typeof input.sms !== "object") {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }
  if (!input.stripe || typeof input.stripe !== "object") {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }
  if (
    !(input.recognizedPriceIds instanceof Set) ||
    input.recognizedPriceIds.size < 1
  ) {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }
  if (typeof input.getPublicMetadata !== "function") {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }
  if (typeof input.purgeFn !== "function") {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }
  if (!input.clerk || typeof input.clerk !== "object") {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }

  let suppressSms;
  let cancelStripe;
  let purgeAppData;
  let clerkAdapter;

  try {
    suppressSms = createTrustedSmsDeletionStage(input.sms);
    cancelStripe = createTrustedCancelStripeStage({
      stripe: input.stripe,
      recognizedPriceIds: input.recognizedPriceIds,
      getPublicMetadata: input.getPublicMetadata,
    });
    purgeAppData = createTrustedPurgeAppDataStage({
      purgeFn: input.purgeFn,
    });
    clerkAdapter = createClerkRestDeletionAdapter(input.clerk);
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }

  return createTrustedAccountDeletionReconcilerDependencies({
    suppressSms,
    cancelStripe,
    purgeAppData,
    deleteClerk: orchestrateClerkDeletion,
    clerkAdapter,
  });
}

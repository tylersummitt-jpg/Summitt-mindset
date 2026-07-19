/**
 * APP-041E4b — explicit production dependency construction for the scheduler.
 *
 * Reads server environment and passes fully explicit inputs into
 * createProductionAccountDeletionReconcilerDependencies.
 *
 * Never called at module import. Never called when the scheduler kill switch
 * is off, when unauthorized, when discovery returns no work, or when discovery
 * fails. Invokes no providers; only composes the frozen trusted bundle.
 */

import "server-only";

import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";

import { createDeletionStripeClientFromSecretKey } from "./cancel-subscription";
import {
  createProductionAccountDeletionReconcilerDependencies,
  PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID,
} from "./create-production-account-deletion-dependencies";
import { purgeAppDataForDeletion } from "./purge-app-data";
import type { AccountDeletionReconcilerDependencies } from "./reconcile-account-deletion";
import { getProductionAccountDeletionSmsDependencies } from "./suppress-sms";

/** Clerk REST delete timeout for scheduler-built adapter (ms). */
export const ACCOUNT_DELETION_SCHEDULER_CLERK_TIMEOUT_MS = 10_000;

/**
 * Build one frozen production reconciler dependency bundle from server env.
 * Throws a non-PII Error on missing/invalid configuration.
 */
export function buildProductionAccountDeletionSchedulerDependencies(): AccountDeletionReconcilerDependencies {
  const clerkSecret =
    typeof process.env.CLERK_SECRET_KEY === "string"
      ? process.env.CLERK_SECRET_KEY.trim()
      : "";
  const stripeSecret =
    typeof process.env.STRIPE_SECRET_KEY === "string"
      ? process.env.STRIPE_SECRET_KEY.trim()
      : "";

  if (!clerkSecret || !stripeSecret) {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }

  const recognizedPriceIds = getRecognizedSummittPriceIds({
    monthly: process.env.STRIPE_PRICE_ID_MONTHLY,
    annual: process.env.STRIPE_PRICE_ID_ANNUAL,
    legacyCsv: process.env.STRIPE_LEGACY_PRICE_IDS,
  });
  if (recognizedPriceIds.size < 1) {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }

  let stripe;
  try {
    stripe = createDeletionStripeClientFromSecretKey(stripeSecret);
  } catch {
    throw new Error(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
  }

  return createProductionAccountDeletionReconcilerDependencies({
    enabled: true,
    sms: getProductionAccountDeletionSmsDependencies(),
    stripe,
    recognizedPriceIds,
    getPublicMetadata: getClerkPublicMetadata,
    purgeFn: purgeAppDataForDeletion,
    clerk: {
      secretKey: clerkSecret,
      fetch: globalThis.fetch.bind(globalThis),
      timeoutMs: ACCOUNT_DELETION_SCHEDULER_CLERK_TIMEOUT_MS,
    },
  });
}

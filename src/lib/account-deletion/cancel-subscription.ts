/**
 * APP-041B3a — Stripe subscription cancellation for account deletion (no public API).
 *
 * Distinct from ordinary churn (`/api/cancel-membership`):
 * - Starts only from sms_suppressed (or resumable canceling / failed_retryable).
 * - Discovers ALL Summitt Mindset subscriptions for the customer (not one Clerk id).
 * - Cancels immediately (never cancel_at_period_end).
 * - Does not write Clerk entitlement metadata or sync SMS audience.
 *
 * Ownership (destructive cancel):
 * - Retrieve Stripe customer before list/cancel; foreign customer.metadata.userId fails closed.
 * - Absent customer.metadata.userId is NOT treated as foreign proof — per-sub rules apply.
 * - Per sub: foreign subscription.metadata.userId is never canceled (price/plan cannot override).
 * - Cancellable only if (A) exact userId match OR (B) recognized Summitt price and no foreign userId.
 * - plan-only metadata is NOT sufficient for cancellation.
 *
 * Missing stripeCustomerId:
 * - Recover via stripeSubscriptionId (retrieve → derive customer → ownership gate → list).
 * - skipped only when no customer handle, no subscription handle, and no credible membership evidence.
 *
 * Postgres and Stripe are NOT one atomic transaction. Safe ordering:
 * - Mark canceling_subscription + stripe_result=pending before any Stripe cancel.
 * - Retries re-list Stripe state; already-canceled subs are safe (no duplicate harm).
 * - Partial cancel + transient failure → failed_retryable + stripe_result=failed;
 *   retry continues remaining live Summitt subs without re-breaking canceled ones.
 * - CAS conflict after external cancel does not claim exactly-once; retry rediscovers.
 */

import "server-only";

import Stripe from "stripe";

import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import {
  classifySummittMembership,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";

import { sanitizeAccountDeletionErrorDetail } from "./sanitize";
import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  acquireAccountDeletionLease,
  getAccountDeletionRequestById,
  recordAccountDeletionFailure,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  type AccountDeletionRepoResult,
} from "./repository";
import type {
  AccountDeletionRequestRow,
  AccountDeletionStepResult,
} from "./types";

/** Minimal Stripe surface used by B3a (injectable for tests). */
export type DeletionStripeClient = {
  customers: {
    retrieve: (
      customerId: string
    ) => Promise<Stripe.Customer | Stripe.DeletedCustomer>;
  };
  subscriptions: {
    retrieve: (subscriptionId: string) => Promise<Stripe.Subscription>;
    list: (params: {
      customer: string;
      status?: Stripe.SubscriptionListParams.Status | "all";
      limit?: number;
      starting_after?: string;
    }) => Promise<{ data: Stripe.Subscription[] }>;
    cancel: (subscriptionId: string) => Promise<Stripe.Subscription>;
  };
};

export type CancelStripeSubscriptionsForDeletionInput = {
  requestId: string;
  clerkUserId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /** Optional CAS version pin (fails closed on mismatch). */
  expectedOrchestrationVersion?: number;
  /** Test injection; production builds a real Stripe client. */
  stripe?: DeletionStripeClient;
  /** Test injection; production reads Clerk public metadata. */
  getPublicMetadata?: (
    clerkUserId: string
  ) => Promise<Record<string, unknown> | null | undefined>;
  /** Test injection for recognized price ids. */
  recognizedPriceIds?: Set<string>;
};

export type CancelStripeSubscriptionsForDeletionValue = {
  row: AccountDeletionRequestRow;
  stripeResult: AccountDeletionStepResult;
  canceledCount: number;
  alreadyTerminalCount: number;
  consideredCount: number;
};

type ClassifiedSub = {
  id: string;
  status: string;
  membership: ReturnType<typeof classifySummittMembership>;
  isSummitt: boolean;
  foreign: boolean;
  terminal: boolean;
};

/** Fail-closed discovery/ownership error (not a raw Stripe transport error). */
export class DeletionDiscoveryError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "DeletionDiscoveryError";
  }
}

export class ConfigurationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ConfigurationError";
  }
}

/**
 * Explicit Stripe client for trusted scheduler wiring.
 * Callers must pass the secret; this never reads process.env.
 */
export function createDeletionStripeClientFromSecretKey(
  secretKey: string
): DeletionStripeClient {
  const key = typeof secretKey === "string" ? secretKey.trim() : "";
  if (!key) {
    throw new ConfigurationError("stripe_secret_missing");
  }
  const stripe = new Stripe(key);
  return {
    customers: {
      retrieve: (id) => stripe.customers.retrieve(id),
    },
    subscriptions: {
      retrieve: (id) => stripe.subscriptions.retrieve(id),
      list: (params) => stripe.subscriptions.list(params),
      cancel: (id) => stripe.subscriptions.cancel(id),
    },
  };
}

function createProductionStripeClient(): DeletionStripeClient {
  return createDeletionStripeClientFromSecretKey(
    process.env.STRIPE_SECRET_KEY ?? ""
  );
}

function isStripeRetryable(err: unknown): boolean {
  if (err instanceof ConfigurationError) return false;
  if (err instanceof DeletionDiscoveryError) return false;
  if (!err || typeof err !== "object") return true;
  const e = err as {
    name?: string;
    type?: string;
    code?: string;
    statusCode?: number;
    rawType?: string;
  };
  if (e.name === "ConfigurationError" || e.name === "DeletionDiscoveryError") {
    return false;
  }
  const status = e.statusCode;
  if (typeof status === "number" && status >= 500) return true;
  if (status === 429) return true;
  if (e.type === "StripeConnectionError" || e.rawType === "connection_error") {
    return true;
  }
  if (e.type === "StripeAPIError" || e.rawType === "api_error") return true;
  if (e.code === "rate_limit") return true;
  if (e.code === "resource_missing") return false;
  return true;
}

function errCode(err: unknown): string | undefined {
  if (err instanceof DeletionDiscoveryError) return err.code;
  if (err instanceof ConfigurationError) return err.code;
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

function hasRecognizedSummittPrice(
  sub: SummittSubscriptionLike,
  recognized: Set<string>
): boolean {
  const items = sub.items?.data;
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    const pid = item?.price?.id;
    if (typeof pid === "string" && pid.trim() && recognized.has(pid.trim())) {
      return true;
    }
  }
  return false;
}

function subscriptionMetadataUserId(
  sub: SummittSubscriptionLike
): string | null {
  const raw = sub.metadata?.userId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Destructive Summitt classification for account deletion.
 *
 * A. metadata.userId exactly matches deleting Clerk user, OR
 * B. at least one recognized current/legacy Summitt price AND no foreign userId.
 *
 * Foreign userId always excludes the subscription (price/plan cannot override).
 * plan-only metadata is NOT sufficient.
 */
export function isLikelySummittSubscriptionForDeletion(
  sub: SummittSubscriptionLike,
  clerkUserId: string,
  recognized: Set<string>
): boolean {
  const mdUser = subscriptionMetadataUserId(sub);
  if (mdUser && mdUser !== clerkUserId) return false;
  if (mdUser && mdUser === clerkUserId) return true;
  return hasRecognizedSummittPrice(sub, recognized);
}

function isTerminalSubscriptionStatus(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

function classifyForDeletion(
  sub: Stripe.Subscription,
  clerkUserId: string,
  recognized: Set<string>
): ClassifiedSub {
  const like = sub as SummittSubscriptionLike;
  const mdUser = subscriptionMetadataUserId(like);
  const foreign = Boolean(mdUser && mdUser !== clerkUserId);
  return {
    id: sub.id,
    status: sub.status,
    membership: classifySummittMembership(like),
    foreign,
    isSummitt: isLikelySummittSubscriptionForDeletion(
      like,
      clerkUserId,
      recognized
    ),
    terminal: isTerminalSubscriptionStatus(sub.status),
  };
}

async function listCustomerSubscriptions(
  stripe: DeletionStripeClient,
  customerId: string
): Promise<Stripe.Subscription[]> {
  const out: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...list.data);
    if (list.data.length < 100) break;
    startingAfter = list.data[list.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return out;
}

function resolveCustomerId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeCustomerId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("cus_")) return null;
  return trimmed;
}

function resolveSubscriptionId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeSubscriptionId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("sub_")) return null;
  return trimmed;
}

/**
 * Credible Summitt membership evidence in Clerk public metadata.
 * Used only to refuse false `skipped` when discovery handles are missing.
 */
export function hasCredibleSummittMembershipEvidence(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata) return false;
  if (isSubscribedFromPublicMetadata(metadata)) return true;
  const plan = metadata.summittPlan;
  if (typeof plan === "string" && plan.trim() === "paused") return true;
  return false;
}

function customerIdFromSubscription(sub: Stripe.Subscription): string | null {
  const c = sub.customer;
  if (typeof c === "string") {
    const trimmed = c.trim();
    return trimmed.startsWith("cus_") ? trimmed : null;
  }
  if (c && typeof c === "object" && "id" in c) {
    const id = (c as { id?: unknown }).id;
    if (typeof id === "string" && id.trim().startsWith("cus_")) {
      return id.trim();
    }
  }
  return null;
}

/**
 * Customer ownership gate before list/cancel.
 * - deleted customer → not usable (caller falls through)
 * - metadata.userId present and ≠ clerk → fail closed
 * - metadata.userId absent → continue; ownership is only partially inferred
 */
async function assertCustomerOwnershipOrThrow(
  stripe: DeletionStripeClient,
  customerId: string,
  clerkUserId: string
): Promise<"ok" | "deleted"> {
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (e) {
    if (errCode(e) === "resource_missing") {
      return "deleted";
    }
    throw e;
  }

  if ((customer as Stripe.DeletedCustomer).deleted) {
    return "deleted";
  }

  const mdUser = (customer as Stripe.Customer).metadata?.userId;
  if (typeof mdUser === "string" && mdUser.trim().length > 0) {
    if (mdUser.trim() !== clerkUserId) {
      throw new DeletionDiscoveryError(
        "stripe_customer_owner_mismatch",
        "Stripe customer metadata userId does not match deleting user"
      );
    }
  }
  // Absent customer.metadata.userId is NOT foreign proof — per-sub rules apply.
  // Customer ownership is partially inferred, not proven, when userId is unset.
  return "ok";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type CancelPassResult = {
  stripeResult: AccountDeletionStepResult;
  canceledCount: number;
  alreadyTerminalCount: number;
  consideredCount: number;
};

async function cancelMatchingLiveSubscriptions(
  stripe: DeletionStripeClient,
  customerId: string,
  clerkUserId: string,
  recognized: Set<string>
): Promise<CancelPassResult> {
  const listed = await listCustomerSubscriptions(stripe, customerId);
  const classified = listed.map((s) =>
    classifyForDeletion(s, clerkUserId, recognized)
  );
  const summitt = classified.filter((c) => c.isSummitt);
  const consideredCount = summitt.length;
  const live = summitt.filter((c) => !c.terminal);
  const terminal = summitt.filter((c) => c.terminal);
  let alreadyTerminalCount = terminal.length;
  let canceledCount = 0;

  if (summitt.length === 0) {
    return {
      stripeResult: "skipped",
      canceledCount: 0,
      alreadyTerminalCount,
      consideredCount,
    };
  }
  if (live.length === 0) {
    return {
      stripeResult: "already_done",
      canceledCount: 0,
      alreadyTerminalCount,
      consideredCount,
    };
  }

  const canceledIds: string[] = [];
  for (const sub of live) {
    try {
      await stripe.subscriptions.cancel(sub.id);
      canceledIds.push(sub.id);
      canceledCount += 1;
    } catch (cancelErr) {
      if (errCode(cancelErr) === "resource_missing") {
        alreadyTerminalCount += 1;
        continue;
      }
      const detail = sanitizeAccountDeletionErrorDetail(errMessage(cancelErr));
      const stepDetail = sanitizeAccountDeletionErrorDetail(
        `canceled_count:${canceledIds.length};failed_after_partial:${canceledIds.length > 0 ? "yes" : "no"}`
      );
      throw Object.assign(
        new DeletionDiscoveryError(
          isStripeRetryable(cancelErr)
            ? "stripe_cancel_transient"
            : "stripe_cancel_failed",
          detail ?? "stripe_cancel_failed"
        ),
        { stepDetail, cause: cancelErr }
      );
    }
  }

  if (canceledCount > 0) {
    return {
      stripeResult: "ok",
      canceledCount,
      alreadyTerminalCount,
      consideredCount,
    };
  }
  if (alreadyTerminalCount > 0) {
    return {
      stripeResult: "already_done",
      canceledCount,
      alreadyTerminalCount,
      consideredCount,
    };
  }
  return {
    stripeResult: "ok",
    canceledCount,
    alreadyTerminalCount,
    consideredCount,
  };
}

/**
 * Resolve a usable customer id with ownership gate.
 * When Clerk lacks stripeCustomerId, recover via stripeSubscriptionId only (no email scan).
 */
async function resolveOwnedCustomerId(input: {
  stripe: DeletionStripeClient;
  clerkUserId: string;
  metadata: Record<string, unknown> | null | undefined;
}): Promise<
  | { kind: "customer"; customerId: string }
  | { kind: "no_handles" }
  | { kind: "subscription_gone" }
> {
  const { stripe, clerkUserId, metadata } = input;
  let customerId = resolveCustomerId(metadata);
  const subscriptionId = resolveSubscriptionId(metadata);
  const membershipEvidence = hasCredibleSummittMembershipEvidence(metadata);

  if (customerId) {
    const gate = await assertCustomerOwnershipOrThrow(
      stripe,
      customerId,
      clerkUserId
    );
    if (gate === "ok") {
      return { kind: "customer", customerId };
    }
    // Deleted / missing customer object — fall through to subscription recovery.
    customerId = null;
  }

  if (subscriptionId) {
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e) {
      if (errCode(e) === "resource_missing") {
        if (membershipEvidence) {
          throw new DeletionDiscoveryError(
            "stripe_discovery_incomplete",
            "Subscription handle gone but Clerk membership evidence remains"
          );
        }
        return { kind: "subscription_gone" };
      }
      throw new DeletionDiscoveryError(
        isStripeRetryable(e)
          ? "stripe_subscription_lookup_failed"
          : "stripe_subscription_lookup_failed",
        sanitizeAccountDeletionErrorDetail(errMessage(e)) ??
          "subscription_lookup_failed"
      );
    }

    const subUser = subscriptionMetadataUserId(sub as SummittSubscriptionLike);
    if (subUser && subUser !== clerkUserId) {
      throw new DeletionDiscoveryError(
        "stripe_subscription_owner_mismatch",
        "Stripe subscription metadata userId does not match deleting user"
      );
    }

    const derived = customerIdFromSubscription(sub);
    if (!derived) {
      throw new DeletionDiscoveryError(
        "stripe_discovery_incomplete",
        "Subscription has no usable customer reference"
      );
    }

    const gate = await assertCustomerOwnershipOrThrow(
      stripe,
      derived,
      clerkUserId
    );
    if (gate === "deleted") {
      if (membershipEvidence || !isTerminalSubscriptionStatus(sub.status)) {
        throw new DeletionDiscoveryError(
          "stripe_discovery_incomplete",
          "Derived customer missing/deleted while subscription or membership evidence remains"
        );
      }
      return { kind: "subscription_gone" };
    }
    return { kind: "customer", customerId: derived };
  }

  if (membershipEvidence) {
    throw new DeletionDiscoveryError(
      "stripe_discovery_incomplete",
      "Clerk membership evidence present without Stripe customer or subscription handle"
    );
  }

  return { kind: "no_handles" };
}

/**
 * Cancel Summitt Stripe subscriptions for an account-deletion request.
 * Requires a valid lockOwner; acquires/releases the B1 lease around the work.
 *
 * Does not call churn cancel-membership. Does not write Clerk entitlement.
 */
export async function cancelStripeSubscriptionsForDeletion(
  input: CancelStripeSubscriptionsForDeletionInput
): Promise<AccountDeletionRepoResult<CancelStripeSubscriptionsForDeletionValue>> {
  const clerkUserId = input.clerkUserId.trim();
  const lockOwner = input.lockOwner.trim();
  if (!clerkUserId || !lockOwner || !input.requestId.trim()) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "requestId, clerkUserId, and lockOwner are required",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const expectedOrchestrationVersion = input.expectedOrchestrationVersion;

  const existing = await getAccountDeletionRequestById(input.requestId);
  if (!existing) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (existing.clerk_user_id !== clerkUserId) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "clerkUserId does not own this deletion request",
    };
  }

  const lease = await acquireAccountDeletionLease({
    requestId: input.requestId,
    lockOwner,
    leaseMs,
    now,
  });
  if (!lease.ok) return lease;

  let row = lease.value;
  let finalRow: AccountDeletionRequestRow | null = null;
  let earlyFailure: AccountDeletionRepoResult<CancelStripeSubscriptionsForDeletionValue> | null =
    null;
  let stripeResult: AccountDeletionStepResult | null = null;
  let canceledCount = 0;
  let alreadyTerminalCount = 0;
  let consideredCount = 0;
  let leaseAlreadyReleased = false;

  try {
    if (row.status === "subscription_canceled") {
      finalRow = row;
      stripeResult = row.stripe_result ?? "already_done";
    } else if (row.status === "sms_suppressed") {
      const toCanceling = await transitionAccountDeletionRequest({
        requestId: input.requestId,
        fromStatus: "sms_suppressed",
        toStatus: "canceling_subscription",
        lockOwner,
        leaseMs,
        now,
        expectedOrchestrationVersion,
        stripeResult: "pending",
        stepNote: { ok: true, code: "stripe_cancel_begin" },
      });
      if (!toCanceling.ok) {
        earlyFailure = toCanceling;
      } else {
        row = toCanceling.value;
      }
    } else if (row.status === "failed_retryable") {
      const resume = await transitionAccountDeletionRequest({
        requestId: input.requestId,
        fromStatus: "failed_retryable",
        toStatus: "canceling_subscription",
        lockOwner,
        leaseMs,
        now,
        expectedOrchestrationVersion,
        stripeResult: "pending",
        stepNote: { ok: true, code: "stripe_cancel_retry" },
      });
      if (!resume.ok) {
        earlyFailure = resume;
      } else {
        row = resume.value;
      }
    } else if (row.status !== "canceling_subscription") {
      earlyFailure = {
        ok: false,
        code: "illegal_transition",
        message: `Cannot cancel Stripe from status ${row.status}`,
      };
    }

    if (!earlyFailure && !finalRow) {
      if (
        row.status !== "canceling_subscription" ||
        row.current_step !== "canceling_subscription"
      ) {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: "Expected canceling_subscription before Stripe work",
        };
      }
    }

    if (!earlyFailure && !finalRow) {
      let stripe: DeletionStripeClient | null = null;
      let recognized: Set<string> | null = null;

      try {
        stripe = input.stripe ?? createProductionStripeClient();
        recognized =
          input.recognizedPriceIds ??
          getRecognizedSummittPriceIds({
            monthly: process.env.STRIPE_PRICE_ID_MONTHLY,
            annual: process.env.STRIPE_PRICE_ID_ANNUAL,
            legacyCsv: process.env.STRIPE_LEGACY_PRICE_IDS,
          });
      } catch (e) {
        const code =
          e instanceof ConfigurationError
            ? e.code
            : "stripe_configuration_error";
        const failed = await recordAccountDeletionFailure({
          requestId: input.requestId,
          fromStatus: "canceling_subscription",
          terminal: false,
          errorCode: code,
          errorDetail: sanitizeAccountDeletionErrorDetail(errMessage(e)),
          lockOwner,
          leaseMs,
          now,
          expectedOrchestrationVersion,
          stripeResult: "failed",
        });
        leaseAlreadyReleased = failed.ok;
        earlyFailure = failed.ok
          ? {
              ok: false,
              code: "internal_error",
              message: "Stripe configuration unavailable for account deletion",
            }
          : failed;
        stripeResult = "failed";
      }

      if (!earlyFailure && stripe && recognized) {
        try {
          const getMd =
            input.getPublicMetadata ??
            ((id: string) => getClerkPublicMetadata(id));
          const metadata = await getMd(clerkUserId);

          const resolved = await resolveOwnedCustomerId({
            stripe,
            clerkUserId,
            metadata: metadata ?? null,
          });

          if (resolved.kind === "no_handles") {
            stripeResult = "skipped";
            consideredCount = 0;
          } else if (resolved.kind === "subscription_gone") {
            // Trusted subscription handle existed but is already absent in Stripe;
            // no remaining membership evidence → already_done (not a blank skipped).
            stripeResult = "already_done";
            alreadyTerminalCount = 1;
            consideredCount = 0;
          } else {
            const pass = await cancelMatchingLiveSubscriptions(
              stripe,
              resolved.customerId,
              clerkUserId,
              recognized
            );
            stripeResult = pass.stripeResult;
            canceledCount = pass.canceledCount;
            alreadyTerminalCount = pass.alreadyTerminalCount;
            consideredCount = pass.consideredCount;
          }

          if (
            !earlyFailure &&
            !finalRow &&
            stripeResult &&
            stripeResult !== "failed"
          ) {
            const toCanceled = await transitionAccountDeletionRequest({
              requestId: input.requestId,
              fromStatus: "canceling_subscription",
              toStatus: "subscription_canceled",
              lockOwner,
              leaseMs,
              now,
              expectedOrchestrationVersion,
              stripeResult,
              stepNote: {
                ok: true,
                code:
                  stripeResult === "ok"
                    ? "stripe_subscriptions_canceled"
                    : stripeResult === "already_done"
                      ? "stripe_already_terminal"
                      : "stripe_no_summitt_subscription",
                detail: `considered:${consideredCount};canceled:${canceledCount};already_terminal:${alreadyTerminalCount};result:${stripeResult}`,
              },
            });
            if (!toCanceled.ok) {
              earlyFailure = toCanceled;
            } else {
              finalRow = toCanceled.value;
            }
          }
        } catch (e) {
          const code =
            e instanceof DeletionDiscoveryError
              ? e.code
              : isStripeRetryable(e)
                ? "stripe_discovery_transient"
                : "stripe_discovery_failed";
          const detail = sanitizeAccountDeletionErrorDetail(errMessage(e));
          const stepDetail =
            e &&
            typeof e === "object" &&
            "stepDetail" in e &&
            typeof (e as { stepDetail?: unknown }).stepDetail === "string"
              ? sanitizeAccountDeletionErrorDetail(
                  (e as { stepDetail: string }).stepDetail
                )
              : null;
          const failed = await recordAccountDeletionFailure({
            requestId: input.requestId,
            fromStatus: "canceling_subscription",
            terminal: false,
            errorCode: code,
            errorDetail: detail,
            lockOwner,
            leaseMs,
            now,
            expectedOrchestrationVersion,
            stripeResult: "failed",
            stepDetail,
          });
          leaseAlreadyReleased = failed.ok;
          earlyFailure = failed.ok
            ? {
                ok: false,
                code: "internal_error",
                message:
                  "Stripe cancellation step failed; request is failed_retryable",
              }
            : failed;
          stripeResult = "failed";
        }
      }
    }
  } finally {
    if (!leaseAlreadyReleased) {
      const release = await releaseAccountDeletionLease({
        requestId: input.requestId,
        lockOwner,
        now,
      });
      if (!release.ok) {
        console.error(
          "[cancelStripeSubscriptionsForDeletion] lease release failed",
          release
        );
      } else if (finalRow) {
        finalRow = release.value;
      }
    }
  }

  if (earlyFailure) return earlyFailure;

  if (!finalRow || !stripeResult) {
    return {
      ok: false,
      code: "internal_error",
      message: "Stripe cancel did not complete",
    };
  }

  return {
    ok: true,
    value: {
      row: finalRow,
      stripeResult,
      canceledCount,
      alreadyTerminalCount,
      consideredCount,
    },
  };
}

/**
 * Silent Stripe membership repair for an already-authenticated Clerk user.
 *
 * Grants only when this user is positively proven to own an entitled Summitt
 * subscription. Customer metadata, stored Stripe ids, price, and plan are
 * discovery aids. They do not authorize access. Stripe is read-only here.
 * A miss, a stale search, or any Stripe failure performs no Clerk write.
 */

import "server-only";

import Stripe from "stripe";
import {
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import type { RecomputeSummittMembershipResult } from "@/lib/summitt-membership-entitlement";
import {
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromAuthoritativeStripeSubscription,
} from "@/lib/summitt-membership-entitlement.server";
import {
  customerIdFromSubscription,
  isSummittEntitledFromSubscription,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";

const SUBSCRIPTION_LIST_LIMIT = 100;
const CUSTOMER_SEARCH_LIMIT = 10;
const CHECKOUT_SESSION_PAGE_LIMIT = 10;
const CHECKOUT_SESSION_MAX_PAGES = 2;
const SAFE_CLERK_USER_ID = /^[A-Za-z0-9_]+$/;

export type StripeMembershipRepairReason =
  | "repaired"
  | "not_proven"
  | "lookup_failed"
  | "deletion_blocked"
  | "clerk_write_failed";

export type StripeMembershipRepairResult = {
  repaired: boolean;
  reason: StripeMembershipRepairReason;
};

export type RepairSubscription = SummittSubscriptionLike & {
  id: string;
};

export type RepairCheckoutSession = {
  id?: string;
  client_reference_id?: string | null;
  metadata?: { userId?: string | null } | null;
  subscription?: string | { id?: string | null } | null;
};

export type StripeMembershipRepairDeps = {
  readClerkPublicMetadata: (
    userId: string
  ) => Promise<Record<string, unknown>>;
  updateClerkPublicMetadata: (
    userId: string,
    fields: Record<string, unknown>
  ) => Promise<void>;
  recompute: (
    userId: string,
    subscription: RepairSubscription
  ) => Promise<RecomputeSummittMembershipResult>;
  deletionAllowed: (
    userId: string
  ) => Promise<
    | { ok: true }
    | { ok: false; code: "account_deletion_in_progress" | "lookup_failed" }
  >;
  stripe: {
    retrieveSubscription: (subscriptionId: string) => Promise<RepairSubscription>;
    listCustomerSubscriptions: (
      customerId: string
    ) => Promise<RepairSubscription[]>;
    searchCustomerIdsByMetadataUserId: (userId: string) => Promise<string[]>;
    listCheckoutSessionsForSubscription: (
      subscriptionId: string
    ) => Promise<RepairCheckoutSession[]>;
  };
};

function readMetadataUserId(
  metadata: { userId?: string | null } | null | undefined
): string | null {
  const value = metadata?.userId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStoredId(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const raw = metadata[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingStripeResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "resource_missing";
}

function isSummittProductSubscription(sub: RepairSubscription): boolean {
  const plan = sub.metadata?.plan;
  if (plan === "monthly" || plan === "annual") return true;
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (typeof priceId !== "string" || priceId.trim().length === 0) return false;
  return getRecognizedSummittPriceIds().has(priceId.trim());
}

function sessionReferencesSubscription(
  session: RepairCheckoutSession,
  subscriptionId: string
): boolean {
  const subscription = session.subscription;
  if (typeof subscription === "string") return subscription === subscriptionId;
  if (
    subscription &&
    typeof subscription === "object" &&
    typeof subscription.id === "string"
  ) {
    return subscription.id === subscriptionId;
  }
  return false;
}

function sessionProvesClerkUser(
  session: RepairCheckoutSession,
  userId: string
): boolean {
  if (session.client_reference_id === userId) return true;
  return readMetadataUserId(session.metadata) === userId;
}

type CandidateDecision = "grant" | "skip" | "lookup_failed";

async function evaluateCandidate(
  deps: StripeMembershipRepairDeps,
  userId: string,
  sub: RepairSubscription
): Promise<CandidateDecision> {
  if (!isSummittProductSubscription(sub)) return "skip";
  if (!isSummittEntitledFromSubscription(sub)) return "skip";

  const subscriptionOwner = readMetadataUserId(sub.metadata);
  if (subscriptionOwner) {
    return subscriptionOwner === userId ? "grant" : "skip";
  }

  let sessions: RepairCheckoutSession[];
  try {
    sessions = await deps.stripe.listCheckoutSessionsForSubscription(sub.id);
  } catch {
    return "lookup_failed";
  }

  const proven = sessions.some(
    (session) =>
      sessionReferencesSubscription(session, sub.id) &&
      sessionProvesClerkUser(session, userId)
  );
  return proven ? "grant" : "skip";
}

async function firstGrant(
  deps: StripeMembershipRepairDeps,
  userId: string,
  subscriptions: RepairSubscription[],
  seen: Set<string>
): Promise<RepairSubscription | "lookup_failed" | null> {
  for (const sub of subscriptions) {
    if (!sub.id || seen.has(sub.id)) continue;
    seen.add(sub.id);
    const decision = await evaluateCandidate(deps, userId, sub);
    if (decision === "lookup_failed") return "lookup_failed";
    if (decision === "grant") return sub;
  }
  return null;
}

function deletionReason(
  code: "account_deletion_in_progress" | "lookup_failed"
): StripeMembershipRepairReason {
  return code === "lookup_failed" ? "lookup_failed" : "deletion_blocked";
}

/**
 * One repair attempt. Positive proof writes Stripe linkage and recomputes.
 * Every other outcome returns without a Clerk write.
 */
export async function attemptStripeMembershipRepair(
  userId: string,
  deps: StripeMembershipRepairDeps
): Promise<StripeMembershipRepairResult> {
  const clerkUserId = userId.trim();
  if (!SAFE_CLERK_USER_ID.test(clerkUserId)) {
    return { repaired: false, reason: "not_proven" };
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = await deps.readClerkPublicMetadata(clerkUserId);
  } catch {
    return { repaired: false, reason: "lookup_failed" };
  }

  const firstGate = await deps.deletionAllowed(clerkUserId);
  if (!firstGate.ok) {
    return { repaired: false, reason: deletionReason(firstGate.code) };
  }

  const storedSubscriptionId = readStoredId(metadata, "stripeSubscriptionId");
  const storedCustomerId = readStoredId(metadata, "stripeCustomerId");
  const seen = new Set<string>();
  let usablePointer = false;

  if (storedSubscriptionId) {
    try {
      const stored = await deps.stripe.retrieveSubscription(storedSubscriptionId);
      usablePointer = true;
      const found = await firstGrant(deps, clerkUserId, [stored], seen);
      if (found === "lookup_failed") {
        return { repaired: false, reason: "lookup_failed" };
      }
      if (found) {
        return commitRepair(deps, clerkUserId, found);
      }
    } catch (error) {
      if (!isMissingStripeResource(error)) {
        return { repaired: false, reason: "lookup_failed" };
      }
    }
  }

  if (storedCustomerId) {
    try {
      const listed = await deps.stripe.listCustomerSubscriptions(storedCustomerId);
      usablePointer = true;
      const found = await firstGrant(deps, clerkUserId, listed, seen);
      if (found === "lookup_failed") {
        return { repaired: false, reason: "lookup_failed" };
      }
      if (found) {
        return commitRepair(deps, clerkUserId, found);
      }
    } catch (error) {
      if (!isMissingStripeResource(error)) {
        return { repaired: false, reason: "lookup_failed" };
      }
    }
  }

  if (usablePointer) {
    return { repaired: false, reason: "not_proven" };
  }

  let customerIds: string[];
  try {
    customerIds = await deps.stripe.searchCustomerIdsByMetadataUserId(clerkUserId);
  } catch {
    return { repaired: false, reason: "lookup_failed" };
  }

  for (const customerId of customerIds.slice(0, CUSTOMER_SEARCH_LIMIT)) {
    if (!customerId) continue;
    let listed: RepairSubscription[];
    try {
      listed = await deps.stripe.listCustomerSubscriptions(customerId);
    } catch {
      return { repaired: false, reason: "lookup_failed" };
    }
    const found = await firstGrant(deps, clerkUserId, listed, seen);
    if (found === "lookup_failed") {
      return { repaired: false, reason: "lookup_failed" };
    }
    if (found) {
      return commitRepair(deps, clerkUserId, found);
    }
  }

  return { repaired: false, reason: "not_proven" };
}

async function commitRepair(
  deps: StripeMembershipRepairDeps,
  userId: string,
  subscription: RepairSubscription
): Promise<StripeMembershipRepairResult> {
  const secondGate = await deps.deletionAllowed(userId);
  if (!secondGate.ok) {
    return { repaired: false, reason: deletionReason(secondGate.code) };
  }

  const linkage: Record<string, unknown> = {
    stripeSubscriptionId: subscription.id,
  };
  const customerId = customerIdFromSubscription(subscription);
  if (customerId) linkage.stripeCustomerId = customerId;

  try {
    await deps.updateClerkPublicMetadata(userId, linkage);
    const projection = await deps.recompute(userId, subscription);
    if (!membershipProjectionClerkSucceeded(projection)) {
      return { repaired: false, reason: "clerk_write_failed" };
    }
  } catch {
    return { repaired: false, reason: "clerk_write_failed" };
  }

  return { repaired: true, reason: "repaired" };
}

function createLiveStripePort(stripe: Stripe): StripeMembershipRepairDeps["stripe"] {
  return {
    retrieveSubscription: (subscriptionId) =>
      stripe.subscriptions.retrieve(subscriptionId),
    listCustomerSubscriptions: async (customerId) => {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: SUBSCRIPTION_LIST_LIMIT,
      });
      return listed.data;
    },
    searchCustomerIdsByMetadataUserId: async (userId) => {
      const found = await stripe.customers.search({
        query: `metadata['userId']:'${userId}'`,
        limit: CUSTOMER_SEARCH_LIMIT,
      });
      return found.data
        .map((customer) => customer.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    },
    listCheckoutSessionsForSubscription: async (subscriptionId) => {
      const sessions: Stripe.Checkout.Session[] = [];
      let startingAfter: string | undefined;
      for (let page = 0; page < CHECKOUT_SESSION_MAX_PAGES; page += 1) {
        const listed = await stripe.checkout.sessions.list({
          subscription: subscriptionId,
          limit: CHECKOUT_SESSION_PAGE_LIMIT,
          starting_after: startingAfter,
        });
        sessions.push(...listed.data);
        if (!listed.has_more) break;
        const lastId = listed.data[listed.data.length - 1]?.id;
        if (!lastId) break;
        startingAfter = lastId;
      }
      return sessions;
    },
  };
}

/** Production entry. Identity comes from the caller’s authenticated user id. */
export async function repairStripeMembershipForUser(
  userId: string
): Promise<StripeMembershipRepairResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { repaired: false, reason: "lookup_failed" };

  try {
    const stripe = new Stripe(key);
    return await attemptStripeMembershipRepair(userId, {
      readClerkPublicMetadata: getClerkPublicMetadata,
      updateClerkPublicMetadata,
      recompute: recomputeMembershipFromAuthoritativeStripeSubscription,
      deletionAllowed: assertEntitlementMutationAllowedForAccountDeletion,
      stripe: createLiveStripePort(stripe),
    });
  } catch {
    return { repaired: false, reason: "lookup_failed" };
  }
}

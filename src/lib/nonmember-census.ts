/**
 * Read-only census of Clerk accounts that are not current members.
 * Uses the existing Stripe classification and Apple grant rules.
 * Unknown entitlement is never called a nonmember.
 * This module does not send email, SMS, or push.
 */

import { CHECKOUT_LIST_NOT_BEFORE_MS, type CheckoutSessionOutcome } from "@/lib/checkout-tracking";
import type { SummittMembershipClass } from "@/lib/summitt-subscription-membership";

export const NONMEMBER_CENSUS_PAGE_SIZE = 100;
export const NONMEMBER_CENSUS_MAX_PAGES = 2;
export const NONMEMBER_CENSUS_STRIPE_RETRIEVE_CAP = 60;
export const NONMEMBER_CENSUS_SESSION_RETRIEVE_CAP = 30;
export const NONMEMBER_CENSUS_LIST_LIMIT = 15;

export const NONMEMBER_CATEGORIES = [
  "checkout_never_recorded",
  "checkout_pending",
  "checkout_expired",
  "checkout_creation_failed",
  "checkout_completed_without_trial",
  "previously_subscribed",
  "insufficient_history",
  "unknown",
] as const;

export type NonmemberCategory = (typeof NONMEMBER_CATEGORIES)[number];

export const NONMEMBER_CATEGORY_LABEL: Record<NonmemberCategory, string> = {
  checkout_never_recorded: "Account created, checkout never recorded",
  checkout_pending: "Checkout started, outcome still pending",
  checkout_expired: "Checkout expired",
  checkout_creation_failed: "Checkout creation failed",
  checkout_completed_without_trial: "Checkout completed, no verified trial",
  previously_subscribed: "Previously subscribed, not active now",
  insufficient_history: "No current membership, history before checkout tracking",
  unknown: "Unknown",
};

const MEMBER_CLASSES = new Set<SummittMembershipClass>([
  "entitled",
  "past_due_recoverable",
  "paused_recoverable",
]);

export type CensusStripeEvidence =
  | "no_subscription_id"
  | "lookup_failed"
  | "not_retrieved"
  | SummittMembershipClass;

export type CensusSessionEvidence = {
  outcome: CheckoutSessionOutcome;
  subscription: "unreadable" | "none" | SummittMembershipClass;
};

export type CensusAccountInput = {
  createdAtMs: number | null;
  hasEmail: boolean;
  apple: "grant" | "no_grant" | "unreadable";
  stripe: CensusStripeEvidence;
  sessions: readonly CensusSessionEvidence[];
  /** Checkout Session ids we recorded but did not read. */
  unreadSessionIds: number;
  creationFailed: boolean;
  eventsComplete: boolean;
};

export type CensusAccountJudgment =
  | { kind: "member" }
  | { kind: "unknown"; reason: "verification" | "unverified_trial" }
  | { kind: "nonmember"; category: NonmemberCategory };

export type NonmemberCensusPage = {
  length: number;
};

export function censusCoverage(args: {
  pageLengths: readonly number[];
  pageSize: number;
  maxPages: number;
  clerkTotal: number | null;
}): { coverage: "complete" | "partial"; examined: number } {
  const examined = args.pageLengths.reduce((sum, length) => sum + length, 0);
  const hitCap =
    args.pageLengths.length >= args.maxPages &&
    (args.pageLengths[args.pageLengths.length - 1] ?? 0) >= args.pageSize;
  const shortOfKnownTotal =
    args.clerkTotal != null && examined < args.clerkTotal;
  if (hitCap || shortOfKnownTotal) {
    return { coverage: "partial", examined };
  }
  return { coverage: "complete", examined };
}

function isMemberClass(value: string): boolean {
  return MEMBER_CLASSES.has(value as SummittMembershipClass);
}

function hasEndedSubscription(input: CensusAccountInput): boolean {
  if (input.stripe === "ended") return true;
  return input.sessions.some((session) => session.subscription === "ended");
}

/**
 * One account. A Stripe customer id is not an input.
 * Trialing is entitled. Paused and past due stay members.
 */
export function judgeCensusAccount(input: CensusAccountInput): CensusAccountJudgment {
  if (input.apple === "unreadable") return { kind: "unknown", reason: "verification" };
  if (input.stripe === "lookup_failed" || input.stripe === "not_retrieved") {
    return { kind: "unknown", reason: "verification" };
  }
  if (input.apple === "grant" || isMemberClass(input.stripe)) {
    return { kind: "member" };
  }
  if (input.sessions.some((session) => isMemberClass(session.subscription))) {
    return { kind: "member" };
  }
  if (
    input.unreadSessionIds > 0 ||
    input.sessions.some((session) => session.subscription === "unreadable")
  ) {
    return { kind: "unknown", reason: "unverified_trial" };
  }
  if (
    input.sessions.some(
      (session) => session.outcome === "completed_trial" && session.subscription === "none"
    )
  ) {
    return { kind: "unknown", reason: "unverified_trial" };
  }

  const category = nonmemberCategory(input);
  return { kind: "nonmember", category };
}

function nonmemberCategory(input: CensusAccountInput): NonmemberCategory {
  if (hasEndedSubscription(input)) return "previously_subscribed";

  const newest = input.sessions[0];
  if (newest) {
    if (newest.outcome === "pending") return "checkout_pending";
    if (newest.outcome === "expired") return "checkout_expired";
    if (newest.outcome === "unknown") return "checkout_completed_without_trial";
    return "unknown";
  }

  if (input.creationFailed) return "checkout_creation_failed";
  if (!input.eventsComplete || input.createdAtMs == null) return "unknown";
  if (input.createdAtMs < CHECKOUT_LIST_NOT_BEFORE_MS) return "insufficient_history";
  return "checkout_never_recorded";
}

export type NonmemberCensusTally = {
  members: number;
  nonmembers: number;
  unknownEntitlement: number;
  unverifiedTrial: number;
  withEmail: number;
  categories: Record<NonmemberCategory, number>;
};

export function emptyCategoryCounts(): Record<NonmemberCategory, number> {
  return {
    checkout_never_recorded: 0,
    checkout_pending: 0,
    checkout_expired: 0,
    checkout_creation_failed: 0,
    checkout_completed_without_trial: 0,
    previously_subscribed: 0,
    insufficient_history: 0,
    unknown: 0,
  };
}

export type NonmemberCensusData = {
  coverage: "complete" | "partial" | "failed";
  examined: number | null;
  clerkTotal: number | null;
  members: number | null;
  nonmembers: number | null;
  unknownEntitlement: number | null;
  unverifiedTrial: number | null;
  withEmail: number | null;
  categories: Record<NonmemberCategory, number>;
  rows: Array<{
    clerkUserId: string;
    createdAtMs: number | null;
    category: NonmemberCategory;
  }>;
};

export function emptyNonmemberCensus(): NonmemberCensusData {
  return {
    coverage: "complete",
    examined: 0,
    clerkTotal: 0,
    members: 0,
    nonmembers: 0,
    unknownEntitlement: 0,
    unverifiedTrial: 0,
    withEmail: 0,
    categories: emptyCategoryCounts(),
    rows: [],
  };
}

export function failedNonmemberCensus(): NonmemberCensusData {
  return {
    coverage: "failed",
    examined: null,
    clerkTotal: null,
    members: null,
    nonmembers: null,
    unknownEntitlement: null,
    unverifiedTrial: null,
    withEmail: null,
    categories: emptyCategoryCounts(),
    rows: [],
  };
}

export function tallyCensusAccounts(
  rows: readonly { hasEmail: boolean; judgment: CensusAccountJudgment }[]
): NonmemberCensusTally {
  const categories = emptyCategoryCounts();
  const tally: NonmemberCensusTally = {
    members: 0,
    nonmembers: 0,
    unknownEntitlement: 0,
    unverifiedTrial: 0,
    withEmail: 0,
    categories,
  };
  for (const row of rows) {
    if (row.hasEmail) tally.withEmail += 1;
    if (row.judgment.kind === "member") tally.members += 1;
    else if (row.judgment.kind === "unknown") {
      tally.unknownEntitlement += 1;
      if (row.judgment.reason === "unverified_trial") tally.unverifiedTrial += 1;
    } else {
      tally.nonmembers += 1;
      tally.categories[row.judgment.category] += 1;
    }
  }
  return tally;
}

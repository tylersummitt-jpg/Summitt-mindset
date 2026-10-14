import {
  APPLE_IAP_MONTHLY_PRODUCT_ID,
  isAppleRowCurrentlyGranting,
} from "@/lib/summitt-membership-entitlement";

/** apple_subscriptions migration. Earlier accounts had no Apple in-app purchase path. */
export const APPLE_IAP_RECORDS_NOT_BEFORE_MS = Date.UTC(2026, 7, 13);

const HISTORICAL_INTERNAL_EMAILS = new Set([
  "tyler@summittmindset.com",
  "appreview@summittmindset.com",
  "challenge+appreview@summittmindset.com",
  "tyler@trysummittmindset.com",
]);

export type HistoricalClassification =
  | "Active membership"
  | "Confirmed former subscriber"
  | "Strong never-subscriber candidate"
  | "Unknown — incomplete evidence"
  | "Test/internal account";

export type HistoricalStripeFinding =
  | "none"
  | "active"
  | "former"
  | "abandoned_incomplete"
  | "unrecognized_price"
  | "unreadable";

export type HistoricalAppleFinding = "none" | "active" | "former" | "sandbox_only" | "unreadable" | "unrecognized_product";

export type HistoricalIdentity = "no_customer" | "resolved_customer" | "unresolved" | "lookup_failed";

export type CustomerIdentityView = {
  id: string;
  userId: string | null;
};

export type HistoricalSubscriptionView = {
  status: string;
  paused: boolean;
  priceRecognized: boolean;
  priceId: string | null;
  ownedByClerkUser: boolean;
  trialStart: number | null;
};

export type HistoricalCheckInput = {
  email: string;
  createdAtMs: number | null;
  metadataClaimsMembership: boolean;
  identity: HistoricalIdentity;
  stripeCustomerFound: boolean;
  subscriptionListComplete: boolean;
  sessionListComplete: boolean;
  stripeFinding: HistoricalStripeFinding;
  apple: HistoricalAppleFinding;
};

export type HistoricalDecision = {
  classification: HistoricalClassification;
  reason: string;
  historyFullyVerified: boolean;
  stripeCustomerFound: "yes" | "no" | "unknown";
  outreachCandidate: boolean;
  sortRank: number;
};

export function isHistoricalInternalAccount(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (HISTORICAL_INTERNAL_EMAILS.has(normalized)) return true;
  if (normalized.endsWith("@example.com") || normalized.endsWith("@example.org")) return true;
  return /^tylersummitt\+[^@]+@gmail\.com$/.test(normalized);
}

export function resolveCustomerIdentity(args: {
  clerkUserId: string;
  storedCustomerId: string;
  emailCustomers: readonly CustomerIdentityView[];
  emailListComplete: boolean;
  userIdCustomers: readonly CustomerIdentityView[];
  userIdSearchComplete: boolean;
  storedCustomer: CustomerIdentityView | null;
  storedLookupFailed: boolean;
}): { identity: HistoricalIdentity; customerIds: string[]; stripeCustomerFound: boolean } {
  if (!args.emailListComplete || !args.userIdSearchComplete || args.storedLookupFailed) {
    return { identity: "lookup_failed", customerIds: [], stripeCustomerFound: false };
  }

  const emailById = new Map(args.emailCustomers.map((customer) => [customer.id, customer]));
  const foreign = args.emailCustomers.filter((customer) => customer.userId != null && customer.userId !== args.clerkUserId);
  if (foreign.length > 0) {
    return { identity: "unresolved", customerIds: [], stripeCustomerFound: true };
  }
  if (args.storedCustomer?.userId != null && args.storedCustomer.userId !== args.clerkUserId) {
    return { identity: "unresolved", customerIds: [], stripeCustomerFound: true };
  }

  const owned = new Map<string, CustomerIdentityView>();
  for (const customer of args.userIdCustomers) {
    if (customer.userId === args.clerkUserId) owned.set(customer.id, customer);
  }
  for (const customer of args.emailCustomers) {
    if (customer.userId === args.clerkUserId) owned.set(customer.id, customer);
  }
  if (args.storedCustomer?.userId === args.clerkUserId) owned.set(args.storedCustomer.id, args.storedCustomer);

  const unclaimed: CustomerIdentityView[] = [];
  for (const customer of args.emailCustomers) {
    if (customer.userId == null && !owned.has(customer.id)) unclaimed.push(customer);
  }
  if (
    args.storedCustomer &&
    args.storedCustomer.userId == null &&
    !owned.has(args.storedCustomer.id) &&
    !unclaimed.some((customer) => customer.id === args.storedCustomer?.id)
  ) {
    unclaimed.push(args.storedCustomer);
  }

  if (unclaimed.length > 1 || (unclaimed.length === 1 && owned.size > 0)) {
    return { identity: "unresolved", customerIds: [], stripeCustomerFound: true };
  }

  const candidates = unclaimed.length === 1 ? unclaimed : [...owned.values()];
  if (args.storedCustomerId && !candidates.some((customer) => customer.id === args.storedCustomerId) && !emailById.has(args.storedCustomerId)) {
    if (!args.storedCustomer) {
      return { identity: "lookup_failed", customerIds: [], stripeCustomerFound: false };
    }
    return { identity: "unresolved", customerIds: [], stripeCustomerFound: true };
  }
  if (candidates.length === 0) {
    return { identity: "no_customer", customerIds: [], stripeCustomerFound: false };
  }
  return {
    identity: "resolved_customer",
    customerIds: candidates.map((customer) => customer.id),
    stripeCustomerFound: true,
  };
}

export function findingFromSubscription(sub: HistoricalSubscriptionView): HistoricalStripeFinding {
  const current = sub.paused || sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
  const trialStarted = sub.trialStart != null;
  const formerStatus = sub.status === "canceled" || sub.status === "unpaid" || (trialStarted && !current);
  const abandoned =
    (sub.status === "incomplete" || sub.status === "incomplete_expired") && !trialStarted && !current;
  if (!current && !formerStatus && !abandoned) return "none";

  const identifiable = sub.priceRecognized || sub.ownedByClerkUser;
  if (!identifiable) {
    return sub.priceId ? "unrecognized_price" : "unreadable";
  }
  if (current) return "active";
  if (formerStatus) return "former";
  return "abandoned_incomplete";
}

const STRIPE_FINDING_PRIORITY: readonly HistoricalStripeFinding[] = [
  "active",
  "former",
  "unreadable",
  "unrecognized_price",
  "abandoned_incomplete",
  "none",
];

export function mergeStripeFindings(findings: readonly HistoricalStripeFinding[]): HistoricalStripeFinding {
  for (const level of STRIPE_FINDING_PRIORITY) {
    if (findings.includes(level)) return level;
  }
  return "none";
}

export function findingFromAppleRows(
  rows: readonly {
    environment: string;
    productId: string;
    status: string;
    expiresAt: string | null;
  }[],
  now: Date
): HistoricalAppleFinding {
  if (rows.length === 0) return "none";
  const product = rows.filter((row) => row.productId === APPLE_IAP_MONTHLY_PRODUCT_ID);
  const production = product.filter((row) => row.environment === "production");
  if (
    production.some((row) =>
      isAppleRowCurrentlyGranting(
        { product_id: row.productId, status: row.status, expires_at: row.expiresAt },
        now
      )
    )
  ) {
    return "active";
  }
  if (production.length > 0) return "former";
  if (product.some((row) => row.environment === "sandbox")) return "sandbox_only";
  if (rows.length > 0) return "unrecognized_product";
  return "none";
}

function customerColumn(found: boolean, identity: HistoricalIdentity): "yes" | "no" | "unknown" {
  if (identity === "lookup_failed") return "unknown";
  return found ? "yes" : "no";
}

export function classifyHistoricalAccount(input: HistoricalCheckInput): HistoricalDecision {
  const stripeCustomerFound = customerColumn(input.stripeCustomerFound, input.identity);
  if (isHistoricalInternalAccount(input.email)) {
    return {
      classification: "Test/internal account",
      reason: "Known development, Apple review, or testing account.",
      historyFullyVerified: false,
      stripeCustomerFound,
      outreachCandidate: false,
      sortRank: 5,
    };
  }

  const positiveActive = input.stripeFinding === "active" || input.apple === "active";
  const positiveFormer =
    !positiveActive &&
    (input.stripeFinding === "former" || input.apple === "former");

  if (positiveActive) {
    return {
      classification: "Active membership",
      reason: "A current Stripe or Apple membership was found. Excluded from outreach.",
      historyFullyVerified: true,
      stripeCustomerFound,
      outreachCandidate: false,
      sortRank: 7,
    };
  }
  if (positiveFormer) {
    return {
      classification: "Confirmed former subscriber",
      reason: "A past Stripe trial or subscription, or a past Apple subscription, was found. No current membership.",
      historyFullyVerified: true,
      stripeCustomerFound,
      outreachCandidate: false,
      sortRank: 6,
    };
  }

  const incomplete =
    input.identity === "lookup_failed" ||
    input.identity === "unresolved" ||
    !input.subscriptionListComplete ||
    !input.sessionListComplete ||
    input.stripeFinding === "unreadable" ||
    input.stripeFinding === "unrecognized_price" ||
    input.apple === "unreadable" ||
    input.apple === "sandbox_only" ||
    input.apple === "unrecognized_product" ||
    input.metadataClaimsMembership;

  if (incomplete) {
    return {
      classification: "Unknown — incomplete evidence",
      reason: unknownReason(input),
      historyFullyVerified: false,
      stripeCustomerFound,
      outreachCandidate: false,
      sortRank: 4,
    };
  }

  const appleEraClear =
    input.apple === "none" &&
    input.createdAtMs != null &&
    input.createdAtMs < APPLE_IAP_RECORDS_NOT_BEFORE_MS;
  const historyFullyVerified =
    input.identity === "resolved_customer" &&
    input.stripeCustomerFound &&
    input.stripeFinding === "none" &&
    input.subscriptionListComplete &&
    input.sessionListComplete &&
    appleEraClear;

  if (input.stripeFinding === "abandoned_incomplete") {
    return {
      classification: "Strong never-subscriber candidate",
      reason:
        "Stripe has only an incomplete subscription and no trial. That was not counted as a membership. History was not fully verified.",
      historyFullyVerified: false,
      stripeCustomerFound,
      outreachCandidate: true,
      sortRank: 3,
    };
  }

  if (historyFullyVerified) {
    return {
      classification: "Strong never-subscriber candidate",
      reason:
        "The matched Stripe customer's subscriptions and Checkout Sessions were fully listed and showed no trial or subscription. This account predates Apple in-app purchase records. A purchase under a different email would not appear.",
      historyFullyVerified: true,
      stripeCustomerFound,
      outreachCandidate: true,
      sortRank: 0,
    };
  }

  if (input.identity === "resolved_customer") {
    return {
      classification: "Strong never-subscriber candidate",
      reason:
        "No trial or subscription was found on the matched Stripe customer, and no Apple subscription row matched. Application Apple records are not a live App Store scan, so this is not fully verified.",
      historyFullyVerified: false,
      stripeCustomerFound,
      outreachCandidate: true,
      sortRank: 1,
    };
  }

  return {
    classification: "Strong never-subscriber candidate",
    reason:
      "No Stripe customer for this email and no Apple subscription row. This is not fully verified, because a membership under a different email would not appear.",
    historyFullyVerified: false,
    stripeCustomerFound,
    outreachCandidate: true,
    sortRank: 2,
  };
}

function unknownReason(input: HistoricalCheckInput): string {
  if (input.metadataClaimsMembership) {
    return "Clerk metadata claims a membership, but no Stripe or Apple subscription was found.";
  }
  if (input.identity === "unresolved") {
    return "Stripe customer identity did not resolve to one account.";
  }
  if (input.stripeFinding === "unrecognized_price") {
    return "A Stripe subscription was found, but its price is not a recognized Summitt price and it is not tied to this account.";
  }
  if (input.apple === "sandbox_only") {
    return "Only a sandbox Apple subscription record was found, so production membership is unresolved.";
  }
  if (input.apple === "unrecognized_product") {
    return "An Apple subscription record did not match the membership product.";
  }
  return "Stripe or Apple history could not be fully read.";
}

export type HistoricalCsvRow = {
  name: string;
  email: string;
  createdAt: string;
  decision: HistoricalDecision;
};

export type HistoricalCsvCounts = {
  cohort: number;
  testInternal: number;
  confirmedFormer: number;
  activeMembership: number;
  strongNeverSubscriber: number;
  unknownIncomplete: number;
  prospects: number;
};

export function emptyHistoricalCounts(): HistoricalCsvCounts {
  return {
    cohort: 0,
    testInternal: 0,
    confirmedFormer: 0,
    activeMembership: 0,
    strongNeverSubscriber: 0,
    unknownIncomplete: 0,
    prospects: 0,
  };
}

export function countHistoricalDecision(counts: HistoricalCsvCounts, decision: HistoricalDecision): void {
  counts.cohort += 1;
  if (decision.classification === "Test/internal account") counts.testInternal += 1;
  else if (decision.classification === "Confirmed former subscriber") counts.confirmedFormer += 1;
  else if (decision.classification === "Active membership") counts.activeMembership += 1;
  else if (decision.classification === "Strong never-subscriber candidate") {
    counts.strongNeverSubscriber += 1;
    if (decision.outreachCandidate) counts.prospects += 1;
  } else counts.unknownIncomplete += 1;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function buildHistoricalNeverSubscriberCsv(
  counts: HistoricalCsvCounts,
  rows: readonly HistoricalCsvRow[]
): string {
  const ordered = [...rows].sort((a, b) => {
    if (a.decision.sortRank !== b.decision.sortRank) return a.decision.sortRank - b.decision.sortRank;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const lines = [
    "# cohort,test_internal,confirmed_former,active_membership,strong_never_subscriber,unknown_incomplete,prospects",
    `# ${counts.cohort},${counts.testInternal},${counts.confirmedFormer},${counts.activeMembership},${counts.strongNeverSubscriber},${counts.unknownIncomplete},${counts.prospects}`,
    [
      "name",
      "email",
      "created_at",
      "classification",
      "reason",
      "history_fully_verified",
      "stripe_customer_found",
      "outreach_candidate",
    ].join(","),
    ...ordered.map((row) =>
      [
        row.name,
        row.email,
        row.createdAt,
        row.decision.classification,
        row.decision.reason,
        row.decision.historyFullyVerified ? "yes" : "no",
        row.decision.stripeCustomerFound,
        row.decision.outreachCandidate ? "yes" : "no",
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

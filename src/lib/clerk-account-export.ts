import {
  NONMEMBER_CATEGORY_LABEL,
  type CensusAccountJudgment,
} from "@/lib/nonmember-census";

export const CLERK_ACCOUNT_EXPORT_TEST_EMAILS = ["tyler@summittmindset.com"] as const;

export type ClerkExportClassification =
  | "Active membership"
  | "Former membership"
  | "Verified never-subscriber"
  | "Unknown";

export type ClerkExportRow = {
  name: string;
  email: string;
  createdAt: string;
  clerkId: string;
  summittSubscribed: string;
  summittPlan: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  classification: ClerkExportClassification;
  reason: string;
};

export type ClerkExportCounts = {
  examined: number;
  excludedTest: number;
  active: number;
  former: number;
  verifiedNeverSubscriber: number;
  unknown: number;
};

export function isExcludedTestAccount(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if ((CLERK_ACCOUNT_EXPORT_TEST_EMAILS as readonly string[]).includes(normalized)) return true;
  return normalized.endsWith("@example.com") || normalized.endsWith("@example.org");
}

export function assertCompleteClerkList(examined: number, clerkTotal: number): void {
  if (!Number.isInteger(examined) || !Number.isInteger(clerkTotal) || examined !== clerkTotal) {
    throw new Error("incomplete_clerk_list");
  }
}

/** Same buckets as the existing census eligibility mapping. Missing history stays Unknown. */
export function classifyCensusJudgment(judgment: CensusAccountJudgment): {
  classification: ClerkExportClassification;
  reason: string;
} {
  if (judgment.kind === "member") {
    return {
      classification: "Active membership",
      reason: "Current Apple or Stripe membership.",
    };
  }
  if (judgment.kind === "unknown") {
    return {
      classification: "Unknown",
      reason:
        judgment.reason === "unverified_trial"
          ? "A checkout or trial was recorded, but the membership was not verified."
          : "Apple, Stripe, or checkout history could not be fully read.",
    };
  }
  if (judgment.category === "previously_subscribed") {
    return {
      classification: "Former membership",
      reason: NONMEMBER_CATEGORY_LABEL.previously_subscribed,
    };
  }
  if (judgment.category === "insufficient_history") {
    return {
      classification: "Unknown",
      reason:
        "No current membership found. Created before 2026-10-10 checkout tracking, so this is not a verified never-subscriber.",
    };
  }
  if (judgment.category === "unknown") {
    return { classification: "Unknown", reason: NONMEMBER_CATEGORY_LABEL.unknown };
  }
  return {
    classification: "Verified never-subscriber",
    reason: NONMEMBER_CATEGORY_LABEL[judgment.category],
  };
}

export function emptyExportCounts(): ClerkExportCounts {
  return {
    examined: 0,
    excludedTest: 0,
    active: 0,
    former: 0,
    verifiedNeverSubscriber: 0,
    unknown: 0,
  };
}

export function countExportRow(counts: ClerkExportCounts, classification: ClerkExportClassification): void {
  if (classification === "Active membership") counts.active += 1;
  else if (classification === "Former membership") counts.former += 1;
  else if (classification === "Verified never-subscriber") counts.verifiedNeverSubscriber += 1;
  else counts.unknown += 1;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function buildClerkAccountExportCsv(counts: ClerkExportCounts, rows: readonly ClerkExportRow[]): string {
  const lines = [
    "# examined,excluded_test,active_membership,former_membership,verified_never_subscriber,unknown",
    `# ${counts.examined},${counts.excludedTest},${counts.active},${counts.former},${counts.verifiedNeverSubscriber},${counts.unknown}`,
    [
      "name",
      "email",
      "created_at",
      "clerk_id",
      "summitt_subscribed",
      "summitt_plan",
      "stripe_subscription_id",
      "stripe_customer_id",
      "classification",
      "reason",
    ].join(","),
    ...rows.map((row) =>
      [
        row.name,
        row.email,
        row.createdAt,
        row.clerkId,
        row.summittSubscribed,
        row.summittPlan,
        row.stripeSubscriptionId,
        row.stripeCustomerId,
        row.classification,
        row.reason,
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  return `${lines.join("\n")}\n`;
}

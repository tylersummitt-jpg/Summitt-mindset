import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { CHECKOUT_LIST_NOT_BEFORE_MS } from "@/lib/checkout-tracking";
import {
  assertCompleteClerkList,
  buildClerkAccountExportCsv,
  classifyCensusJudgment,
  countExportRow,
  emptyExportCounts,
  isExcludedTestAccount,
} from "@/lib/clerk-account-export";
import { judgeCensusAccount, type CensusAccountInput } from "@/lib/nonmember-census";

function account(overrides: Partial<CensusAccountInput> = {}): CensusAccountInput {
  return {
    createdAtMs: CHECKOUT_LIST_NOT_BEFORE_MS + 86_400_000,
    hasEmail: true,
    apple: "no_grant",
    stripe: "no_subscription_id",
    sessions: [],
    unreadSessionIds: 0,
    creationFailed: false,
    eventsComplete: true,
    ...overrides,
  };
}

describe("clerk account export", () => {
  it("keeps missing history unknown and excludes known test mailboxes", () => {
    expect(classifyCensusJudgment(judgeCensusAccount(account())).classification).toBe(
      "Verified never-subscriber"
    );
    expect(
      classifyCensusJudgment(
        judgeCensusAccount(account({ createdAtMs: CHECKOUT_LIST_NOT_BEFORE_MS - 86_400_000 }))
      )
    ).toEqual({
      classification: "Unknown",
      reason:
        "No current membership found. Created before 2026-10-10 checkout tracking, so this is not a verified never-subscriber.",
    });
    expect(classifyCensusJudgment(judgeCensusAccount(account({ stripe: "ended" }))).classification).toBe(
      "Former membership"
    );
    expect(classifyCensusJudgment(judgeCensusAccount(account({ stripe: "entitled" }))).classification).toBe(
      "Active membership"
    );
    expect(classifyCensusJudgment(judgeCensusAccount(account({ apple: "unreadable" }))).classification).toBe(
      "Unknown"
    );
    expect(isExcludedTestAccount("Tyler@summittmindset.com")).toBe(true);
    expect(isExcludedTestAccount("person@example.com")).toBe(true);
    expect(isExcludedTestAccount("person@gmail.com")).toBe(false);
    expect(() => assertCompleteClerkList(10, 11)).toThrow("incomplete_clerk_list");
    expect(() => assertCompleteClerkList(4, 4)).not.toThrow();
  });

  it("writes counts and does not publish a partial Clerk list from a public route", () => {
    const counts = emptyExportCounts();
    counts.examined = 2;
    counts.excludedTest = 1;
    countExportRow(counts, "Unknown");
    const csv = buildClerkAccountExportCsv(counts, [
      {
        name: "Ada",
        email: "ada@example.net",
        createdAt: "2026-01-01T00:00:00.000Z",
        clerkId: "user_1",
        summittSubscribed: "",
        summittPlan: "",
        stripeSubscriptionId: "",
        stripeCustomerId: "",
        classification: "Unknown",
        reason: "No current membership found.",
      },
    ]);
    expect(csv.startsWith("# examined,excluded_test,active_membership,former_membership,verified_never_subscriber,unknown\n# 2,1,0,0,0,1\n")).toBe(
      true
    );
    expect(csv).not.toContain("tyler@summittmindset.com");
    const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(middleware).not.toContain("clerk-account-export");
  });
});

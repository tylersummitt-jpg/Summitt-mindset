import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { APPLE_IAP_RECORDS_NOT_BEFORE_MS } from "@/lib/historical-never-subscriber";
import {
  buildHistoricalNeverSubscriberCsv,
  classifyHistoricalAccount,
  countHistoricalDecision,
  emptyHistoricalCounts,
  findingFromAppleRows,
  findingFromSubscription,
  isHistoricalInternalAccount,
  mergeStripeFindings,
  resolveCustomerIdentity,
  type HistoricalCheckInput,
} from "@/lib/historical-never-subscriber";

const PRODUCT = "com.summittmindset.ios.membership.monthly";

function check(overrides: Partial<HistoricalCheckInput> = {}): HistoricalCheckInput {
  return {
    email: "ada@example.net",
    createdAtMs: APPLE_IAP_RECORDS_NOT_BEFORE_MS - 86_400_000,
    metadataClaimsMembership: false,
    identity: "no_customer",
    stripeCustomerFound: false,
    subscriptionListComplete: true,
    sessionListComplete: true,
    stripeFinding: "none",
    apple: "none",
    ...overrides,
  };
}

describe("historical never-subscriber reconciliation", () => {
  it("classifies positive history, unresolved history, and known test accounts separately", () => {
    expect(isHistoricalInternalAccount("appreview@summittmindset.com")).toBe(true);
    expect(isHistoricalInternalAccount("tylersummitt+1199@gmail.com")).toBe(true);
    expect(isHistoricalInternalAccount("brooke.rahn@gmail.com")).toBe(false);

    expect(classifyHistoricalAccount(check({ email: "tyler@trysummittmindset.com" })).classification).toBe(
      "Test/internal account"
    );
    expect(classifyHistoricalAccount(check({ stripeFinding: "active" })).classification).toBe("Active membership");
    expect(classifyHistoricalAccount(check({ stripeFinding: "former", identity: "resolved_customer", stripeCustomerFound: true })).classification).toBe(
      "Confirmed former subscriber"
    );
    expect(
      classifyHistoricalAccount(check({ apple: "former", identity: "resolved_customer", stripeCustomerFound: true })).outreachCandidate
    ).toBe(false);

    const verified = classifyHistoricalAccount(
      check({ identity: "resolved_customer", stripeCustomerFound: true })
    );
    expect(verified.classification).toBe("Strong never-subscriber candidate");
    expect(verified.historyFullyVerified).toBe(true);
    expect(verified.outreachCandidate).toBe(true);

    const noCustomer = classifyHistoricalAccount(check());
    expect(noCustomer.classification).toBe("Strong never-subscriber candidate");
    expect(noCustomer.historyFullyVerified).toBe(false);

    const laterAppleEra = classifyHistoricalAccount(
      check({
        identity: "resolved_customer",
        stripeCustomerFound: true,
        createdAtMs: APPLE_IAP_RECORDS_NOT_BEFORE_MS + 86_400_000,
      })
    );
    expect(laterAppleEra.historyFullyVerified).toBe(false);

    expect(classifyHistoricalAccount(check({ metadataClaimsMembership: true })).classification).toBe(
      "Unknown — incomplete evidence"
    );
    expect(classifyHistoricalAccount(check({ identity: "unresolved", stripeCustomerFound: true })).classification).toBe(
      "Unknown — incomplete evidence"
    );
    expect(classifyHistoricalAccount(check({ stripeFinding: "unrecognized_price" })).classification).toBe(
      "Unknown — incomplete evidence"
    );
    expect(classifyHistoricalAccount(check({ identity: "lookup_failed" })).stripeCustomerFound).toBe("unknown");
    expect(
      classifyHistoricalAccount(
        check({ stripeFinding: "abandoned_incomplete", identity: "resolved_customer", stripeCustomerFound: true })
      ).historyFullyVerified
    ).toBe(false);
  });

  it("does not treat a customer, an incomplete subscription, or a missing price as a past membership", () => {
    expect(
      findingFromSubscription({
        status: "canceled",
        paused: false,
        priceRecognized: true,
        priceId: "price_1",
        ownedByClerkUser: false,
        trialStart: 1,
      })
    ).toBe("former");
    expect(
      findingFromSubscription({
        status: "incomplete_expired",
        paused: false,
        priceRecognized: true,
        priceId: "price_1",
        ownedByClerkUser: false,
        trialStart: null,
      })
    ).toBe("abandoned_incomplete");
    expect(
      findingFromSubscription({
        status: "canceled",
        paused: false,
        priceRecognized: false,
        priceId: "price_old",
        ownedByClerkUser: true,
        trialStart: null,
      })
    ).toBe("former");
    expect(
      findingFromSubscription({
        status: "trialing",
        paused: false,
        priceRecognized: true,
        priceId: "price_1",
        ownedByClerkUser: false,
        trialStart: 1,
      })
    ).toBe("active");
    expect(mergeStripeFindings(["abandoned_incomplete", "former"])).toBe("former");
    expect(
      findingFromAppleRows(
        [{ environment: "production", productId: PRODUCT, status: "expired", expiresAt: "2026-01-01T00:00:00.000Z" }],
        new Date("2026-10-01T00:00:00.000Z")
      )
    ).toBe("former");
    expect(
      findingFromAppleRows(
        [{ environment: "sandbox", productId: PRODUCT, status: "active", expiresAt: "2026-12-01T00:00:00.000Z" }],
        new Date("2026-10-01T00:00:00.000Z")
      )
    ).toBe("sandbox_only");

    expect(
      resolveCustomerIdentity({
        clerkUserId: "user_1",
        storedCustomerId: "cus_1",
        emailCustomers: [{ id: "cus_1", userId: null }],
        emailListComplete: true,
        userIdCustomers: [],
        userIdSearchComplete: true,
        storedCustomer: { id: "cus_1", userId: null },
        storedLookupFailed: false,
      }).identity
    ).toBe("resolved_customer");
    expect(
      resolveCustomerIdentity({
        clerkUserId: "user_1",
        storedCustomerId: "",
        emailCustomers: [
          { id: "cus_1", userId: null },
          { id: "cus_2", userId: null },
        ],
        emailListComplete: true,
        userIdCustomers: [],
        userIdSearchComplete: true,
        storedCustomer: null,
        storedLookupFailed: false,
      }).identity
    ).toBe("unresolved");
    expect(
      resolveCustomerIdentity({
        clerkUserId: "user_1",
        storedCustomerId: "",
        emailCustomers: [],
        emailListComplete: true,
        userIdCustomers: [],
        userIdSearchComplete: true,
        storedCustomer: null,
        storedLookupFailed: false,
      })
    ).toEqual({ identity: "no_customer", customerIds: [], stripeCustomerFound: false });
  });

  it("sorts prospects ahead of unknown and former accounts and keeps the download private", () => {
    const counts = emptyHistoricalCounts();
    const prospect = classifyHistoricalAccount(check());
    const unknown = classifyHistoricalAccount(check({ identity: "lookup_failed" }));
    const former = classifyHistoricalAccount(check({ stripeFinding: "former" }));
    countHistoricalDecision(counts, prospect);
    countHistoricalDecision(counts, unknown);
    countHistoricalDecision(counts, former);
    const csv = buildHistoricalNeverSubscriberCsv(counts, [
      { name: "Former", email: "former@example.net", createdAt: "2026-01-01T00:00:00.000Z", decision: former },
      { name: "Unknown", email: "unknown@example.net", createdAt: "2026-01-02T00:00:00.000Z", decision: unknown },
      { name: "Prospect", email: "prospect@example.net", createdAt: "2026-01-03T00:00:00.000Z", decision: prospect },
    ]);
    expect(csv.startsWith("# cohort,test_internal,confirmed_former,active_membership,strong_never_subscriber,unknown_incomplete,prospects\n# 3,0,1,0,1,1,1\n")).toBe(true);
    const body = csv.split("\n").slice(3);
    expect(body[0]).toContain("prospect@example.net");
    expect(body[1]).toContain("unknown@example.net");
    expect(body[2]).toContain("former@example.net");
    expect(body[0]?.endsWith(",yes")).toBe(true);
    expect(body[2]?.endsWith(",no")).toBe(true);

    const route = readFileSync(join(process.cwd(), "src/app/api/admin/historical-never-subscriber/route.ts"), "utf8");
    const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(route).toContain("requireTylerAdmin");
    expect(route).toContain("incomplete_clerk_list");
    expect(route).toContain('filename="historical-never-subscriber.csv"');
    expect(route).not.toContain("console.log");
    expect(middleware).not.toContain("historical-never-subscriber");
    expect(middleware).not.toContain("clerk-account-export");
  });
});

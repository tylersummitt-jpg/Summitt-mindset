import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clerkStripeSubscriptionId,
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
  latestGrantingAppleCreatedAtIso,
  normalizeAdminCustomerNotesPatch,
  orderAndPaginateSubscribedCustomers,
  resolveQuotesBookSentAtPatch,
  subscribedAtMs,
  subscribedAtMsForCustomer,
  type StripeSubscriptionTime,
} from "@/lib/admin-customers-dashboard-pure";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "@/lib/summitt-membership-entitlement";

describe("admin-customers-dashboard", () => {
  describe("isCurrentSubscribedMember", () => {
    it("requires summittSubscribed === true strictly", () => {
      expect(isCurrentSubscribedMember({ summittSubscribed: true })).toBe(true);
      expect(isCurrentSubscribedMember({ summittSubscribed: "true" })).toBe(false);
      expect(isCurrentSubscribedMember({ summittPlan: "monthly" })).toBe(false);
      expect(isCurrentSubscribedMember(null)).toBe(false);
    });
  });

  describe("formatSubscriptionLabel", () => {
    it("includes plan when present", () => {
      expect(formatSubscriptionLabel({ summittPlan: "annual" })).toBe("Active (annual)");
      expect(formatSubscriptionLabel({ summittPlan: "monthly" })).toBe("Active (monthly)");
      expect(formatSubscriptionLabel({})).toBe("Active");
    });
  });

  describe("formatTextStatusLabel", () => {
    it("maps known statuses", () => {
      expect(formatTextStatusLabel("paused")).toBe("Paused");
      expect(formatTextStatusLabel("not_configured")).toBe("Not configured");
    });
  });

  describe("normalizeAdminCustomerNotesPatch", () => {
    it("accepts valid payload", () => {
      const r = normalizeAdminCustomerNotesPatch({
        tylerNotes: "  Called today ",
        sentQuotesBook: true,
        otherItemsSent: " shirt ",
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.tylerNotes).toBe("Called today");
        expect(r.value.otherItemsSent).toBe("shirt");
      }
    });

    it("rejects invalid sentQuotesBook", () => {
      const r = normalizeAdminCustomerNotesPatch({
        tylerNotes: "",
        sentQuotesBook: "yes",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("resolveQuotesBookSentAtPatch", () => {
    const now = "2026-06-25T12:00:00.000Z";

    it("sets timestamp on false to true", () => {
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: false,
          nextSent: true,
          previousSentAt: null,
          nowIso: now,
        })
      ).toBe(now);
    });

    it("clears timestamp when unchecked", () => {
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: true,
          nextSent: false,
          previousSentAt: now,
          nowIso: now,
        })
      ).toBeNull();
    });

    it("preserves timestamp when already sent", () => {
      const prior = "2026-01-01T00:00:00.000Z";
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: true,
          nextSent: true,
          previousSentAt: prior,
          nowIso: now,
        })
      ).toBe(prior);
    });
  });

  describe("subscribed universe is unchanged", () => {
    it("still includes trialing and cancel-at-period-end the same way: Clerk flag only", () => {
      expect(
        isCurrentSubscribedMember({
          summittSubscribed: true,
          summittPlan: "monthly",
          stripeSubscriptionId: "sub_trial",
        })
      ).toBe(true);
      expect(
        isCurrentSubscribedMember({
          summittSubscribed: true,
          summittPlan: "annual",
        })
      ).toBe(true);
    });

    it("still excludes paused/ended users that lack summittSubscribed true", () => {
      expect(isCurrentSubscribedMember({ summittPlan: "paused" })).toBe(false);
      expect(
        isCurrentSubscribedMember({
          summittSubscribed: false,
          stripeSubscriptionId: "sub_ended",
        })
      ).toBe(false);
      expect(isCurrentSubscribedMember({ summittSubscribed: "true" })).toBe(false);
    });
  });
});

const CLERK_OLD_MS = Date.parse("2020-01-15T00:00:00.000Z");
const CLERK_NEW_MS = Date.parse("2026-09-14T00:00:00.000Z");
const STRIPE_OLD_SEC = Math.floor(Date.parse("2024-02-01T00:00:00.000Z") / 1000);
const STRIPE_NEW_SEC = Math.floor(Date.parse("2026-09-15T12:00:00.000Z") / 1000);
const STRIPE_CREATED_ONLY_SEC = Math.floor(
  Date.parse("2026-08-01T00:00:00.000Z") / 1000
);
const APPLE_ISO = "2026-07-01T00:00:00.000Z";
const APPLE_NEWER_ISO = "2026-09-15T18:00:00.000Z";
const NOW = new Date("2026-09-15T20:00:00.000Z");

function stripeTimes(
  start: number | null,
  created: number | null
): StripeSubscriptionTime {
  return { startDateUnixSeconds: start, createdUnixSeconds: created };
}

function pageIds(users: Array<{ id: string; at: number }>, page: number, limit: number) {
  return orderAndPaginateSubscribedCustomers({
    users,
    page,
    limit,
    subscribedAtMsFor: (u) => u.at,
  }).users.map((u) => u.id);
}

describe("subscribedAtMs", () => {
  it("uses Stripe start_date as the subscription timestamp", () => {
    expect(
      subscribedAtMs({
        stripe: stripeTimes(STRIPE_NEW_SEC, STRIPE_OLD_SEC),
        appleGrantCreatedAtIso: null,
        clerkCreatedAtMs: CLERK_NEW_MS,
      })
    ).toBe(STRIPE_NEW_SEC * 1000);
  });

  it("Stripe start_date wins over a newer Clerk created_at", () => {
    const ms = subscribedAtMs({
      stripe: stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC),
      clerkCreatedAtMs: CLERK_NEW_MS,
    });
    expect(ms).toBe(STRIPE_OLD_SEC * 1000);
    expect(ms).toBeLessThan(CLERK_NEW_MS);
  });

  it("uses Stripe created when start_date is missing", () => {
    expect(
      subscribedAtMs({
        stripe: stripeTimes(null, STRIPE_CREATED_ONLY_SEC),
        clerkCreatedAtMs: CLERK_OLD_MS,
      })
    ).toBe(STRIPE_CREATED_ONLY_SEC * 1000);
  });

  it("trial uses subscription start, not trial_end", () => {
    const trialEndUnixSeconds = STRIPE_NEW_SEC + 7 * 24 * 3600;
    const stripe = {
      ...stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC),
      trialEndUnixSeconds,
      currentPeriodStartUnixSeconds: STRIPE_NEW_SEC,
    };
    expect(
      subscribedAtMs({
        stripe,
        clerkCreatedAtMs: CLERK_NEW_MS,
      })
    ).toBe(STRIPE_OLD_SEC * 1000);
    expect(subscribedAtMs({ stripe })).not.toBe(trialEndUnixSeconds * 1000);
  });

  it("annual uses the same Stripe start_date logic as monthly", () => {
    const monthly = subscribedAtMs({
      stripe: stripeTimes(STRIPE_NEW_SEC, STRIPE_OLD_SEC),
    });
    const annual = subscribedAtMs({
      stripe: stripeTimes(STRIPE_NEW_SEC, STRIPE_OLD_SEC),
    });
    expect(monthly).toBe(annual);
    expect(monthly).toBe(STRIPE_NEW_SEC * 1000);
  });

  it("Apple-only uses apple_subscriptions.created_at", () => {
    expect(
      subscribedAtMs({
        stripe: null,
        appleGrantCreatedAtIso: APPLE_ISO,
        clerkCreatedAtMs: CLERK_NEW_MS,
      })
    ).toBe(Date.parse(APPLE_ISO));
  });

  it("Stripe + Apple uses the more recent granting timestamp", () => {
    expect(
      subscribedAtMs({
        stripe: stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC),
        appleGrantCreatedAtIso: APPLE_NEWER_ISO,
        clerkCreatedAtMs: CLERK_OLD_MS,
      })
    ).toBe(Date.parse(APPLE_NEWER_ISO));
    expect(
      subscribedAtMs({
        stripe: stripeTimes(STRIPE_NEW_SEC, STRIPE_NEW_SEC),
        appleGrantCreatedAtIso: APPLE_ISO,
      })
    ).toBe(STRIPE_NEW_SEC * 1000);
  });

  it("falls back to Clerk created_at only when billing timestamps are missing", () => {
    expect(
      subscribedAtMs({
        stripe: null,
        appleGrantCreatedAtIso: null,
        clerkCreatedAtMs: CLERK_OLD_MS,
      })
    ).toBe(CLERK_OLD_MS);
  });

  it("does not sort by current_period_start, last SMS, onboarding, or Clerk updated_at", () => {
    const currentPeriodStartUnixSeconds = STRIPE_NEW_SEC;
    const lastSmsAtMs = Date.parse("2026-09-15T23:00:00.000Z");
    const onboardingCompletedAtMs = Date.parse("2026-09-15T22:00:00.000Z");
    const clerkUpdatedAtMs = Date.parse("2026-09-15T21:00:00.000Z");
    const stripe = {
      ...stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC),
      currentPeriodStartUnixSeconds,
      lastSmsAtMs,
      onboardingCompletedAtMs,
      clerkUpdatedAtMs,
    };
    const ms = subscribedAtMs({
      stripe,
      clerkCreatedAtMs: CLERK_NEW_MS,
    });
    expect(ms).toBe(STRIPE_OLD_SEC * 1000);
    expect(ms).not.toBe(currentPeriodStartUnixSeconds * 1000);
    expect(ms).not.toBe(lastSmsAtMs);
    expect(ms).not.toBe(onboardingCompletedAtMs);
    expect(ms).not.toBe(clerkUpdatedAtMs);
    expect(ms).not.toBe(CLERK_NEW_MS);
  });
});

describe("latestGrantingAppleCreatedAtIso", () => {
  it("uses created_at of the granting Apple row", () => {
    expect(
      latestGrantingAppleCreatedAtIso(
        [
          {
            product_id: APPLE_IAP_MONTHLY_PRODUCT_ID,
            status: "active",
            expires_at: "2026-12-01T00:00:00.000Z",
            created_at: APPLE_ISO,
          },
        ],
        NOW
      )
    ).toBe(APPLE_ISO);
  });

  it("ignores expired Apple rows", () => {
    expect(
      latestGrantingAppleCreatedAtIso(
        [
          {
            product_id: APPLE_IAP_MONTHLY_PRODUCT_ID,
            status: "expired",
            expires_at: "2026-01-01T00:00:00.000Z",
            created_at: APPLE_NEWER_ISO,
          },
        ],
        NOW
      )
    ).toBeNull();
  });
});

describe("orderAndPaginateSubscribedCustomers", () => {
  it("sorts newest Stripe subscription first before paginating", () => {
    const stripeTimesBySubscriptionId = new Map<string, StripeSubscriptionTime>([
      ["sub_old", stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC)],
      ["sub_new", stripeTimes(STRIPE_NEW_SEC, STRIPE_NEW_SEC)],
    ]);
    const users = [
      {
        id: "user_old_sub",
        created_at: CLERK_NEW_MS,
        public_metadata: {
          summittSubscribed: true,
          stripeSubscriptionId: "sub_old",
        },
      },
      {
        id: "user_new_sub",
        created_at: CLERK_OLD_MS,
        public_metadata: {
          summittSubscribed: true,
          stripeSubscriptionId: "sub_new",
        },
      },
    ];
    const ranked = orderAndPaginateSubscribedCustomers({
      users,
      page: 1,
      limit: 50,
      subscribedAtMsFor: (user) =>
        subscribedAtMsForCustomer({
          clerkCreatedAtMs: user.created_at,
          stripeSubscriptionId: clerkStripeSubscriptionId(user.public_metadata),
          stripeTimesBySubscriptionId,
          appleGrantCreatedAtIso: null,
        }),
    });
    expect(ranked.users.map((u) => u.id)).toEqual(["user_new_sub", "user_old_sub"]);
  });

  it("places an old Clerk account with a new Stripe subscription at the top", () => {
    const stripeTimesBySubscriptionId = new Map<string, StripeSubscriptionTime>([
      ["sub_today", stripeTimes(STRIPE_NEW_SEC, STRIPE_NEW_SEC)],
      ["sub_last_year", stripeTimes(STRIPE_OLD_SEC, STRIPE_OLD_SEC)],
    ]);
    const users = [
      {
        id: "new_account_old_sub",
        created_at: CLERK_NEW_MS,
        stripeSubscriptionId: "sub_last_year",
      },
      {
        id: "legacy_reactivated",
        created_at: CLERK_OLD_MS,
        stripeSubscriptionId: "sub_today",
      },
    ];
    const ranked = orderAndPaginateSubscribedCustomers({
      users,
      page: 1,
      limit: 10,
      subscribedAtMsFor: (user) =>
        subscribedAtMsForCustomer({
          clerkCreatedAtMs: user.created_at,
          stripeSubscriptionId: user.stripeSubscriptionId,
          stripeTimesBySubscriptionId,
          appleGrantCreatedAtIso: null,
        }),
    });
    expect(ranked.users[0]?.id).toBe("legacy_reactivated");
  });

  it("globally sorts before pagination so page 1 is newest subscribers", () => {
    const input = [
      { id: "oldest", at: 1 },
      { id: "mid", at: 2 },
      { id: "newest", at: 3 },
      { id: "older", at: 1.5 },
    ];
    expect(pageIds(input, 1, 2)).toEqual(["newest", "mid"]);
    expect(pageIds(input, 2, 2)).toEqual(["older", "oldest"]);
  });

  it("page 2 continues newest-first order", () => {
    const input = [
      { id: "f", at: 1 },
      { id: "a", at: 6 },
      { id: "e", at: 2 },
      { id: "b", at: 5 },
      { id: "d", at: 3 },
      { id: "c", at: 4 },
    ];
    const page1 = orderAndPaginateSubscribedCustomers({
      users: input,
      page: 1,
      limit: 3,
      subscribedAtMsFor: (u) => u.at,
    });
    const page2 = orderAndPaginateSubscribedCustomers({
      users: input,
      page: 2,
      limit: 3,
      subscribedAtMsFor: (u) => u.at,
    });
    expect(page1.users.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(page1.hasMore).toBe(true);
    expect(page2.users.map((u) => u.id)).toEqual(["d", "e", "f"]);
    expect(page2.hasMore).toBe(false);
  });

  it("does not drop currently entitled users while sorting", () => {
    const users = [
      { id: "trialing", at: 2 },
      { id: "cancel_at_period_end", at: 3 },
      { id: "annual", at: 1 },
    ];
    const ranked = orderAndPaginateSubscribedCustomers({
      users,
      page: 1,
      limit: 50,
      subscribedAtMsFor: (u) => u.at,
    });
    expect(ranked.users.map((u) => u.id).sort()).toEqual(
      ["annual", "cancel_at_period_end", "trialing"].sort()
    );
  });
});

describe("admin-customers-dashboard loader wiring", () => {
  const src = readFileSync("src/lib/admin-customers-dashboard.ts", "utf8");

  it("collects the full subscribed set before sorting and paginating", () => {
    expect(src).toContain("listAllSubscribedClerkUsers");
    expect(src).toContain("orderAndPaginateSubscribedCustomers");
    expect(src).not.toContain("subscribedIndex");
    expect(src).not.toMatch(/collected\.length < target/);
  });

  it("retrieves the current stripeSubscriptionId in bounded chunks", () => {
    expect(src).toContain("stripe.subscriptions.retrieve");
    expect(src).toContain("STRIPE_RETRIEVE_CHUNK = 10");
    expect(src).not.toContain("subscriptions.list");
    expect(src).not.toContain("trial_end");
    expect(src).not.toContain("current_period_start");
  });
});

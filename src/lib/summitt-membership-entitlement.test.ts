import { describe, expect, it, vi } from "vitest";
import {
  APPLE_IAP_MONTHLY_PRODUCT_ID,
  combineMembershipGrants,
  isAppleRowCurrentlyGranting,
  recomputeSummittMembershipEntitlement,
  resolveAppleMembershipGrantFromRecords,
  resolveStripeMembershipGrantFromSubscription,
  type AppleSubscriptionGrantRecord,
  type MembershipEntitlementDeps,
  type MembershipGrant,
  type MembershipProjection,
} from "./summitt-membership-entitlement";
import type { SummittSubscriptionLike } from "./summitt-subscription-membership";

const NOW = new Date("2026-08-13T20:00:00.000Z");
const FUTURE = "2026-09-13T20:00:00.000Z";
const PAST = "2026-07-13T20:00:00.000Z";
const USER_ID = "user_phase2";

function stripeSub(
  partial: Partial<SummittSubscriptionLike> & { status: string }
): SummittSubscriptionLike {
  return {
    pause_collection: null,
    items: {
      data: [
        {
          price: {
            id: "price_test",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...partial,
  };
}

function appleRow(
  partial: Partial<AppleSubscriptionGrantRecord> = {}
): AppleSubscriptionGrantRecord {
  return {
    product_id: APPLE_IAP_MONTHLY_PRODUCT_ID,
    status: "active",
    expires_at: FUTURE,
    ...partial,
  };
}

function stripeGrant(
  partial: Partial<MembershipGrant> = {}
): MembershipGrant {
  return {
    grantsAccess: true,
    plan: "monthly",
    source: "stripe",
    ...partial,
  };
}

function appleGrant(
  partial: Partial<MembershipGrant> = {}
): MembershipGrant {
  return {
    grantsAccess: true,
    plan: "monthly",
    source: "apple",
    ...partial,
  };
}

function makeDeps(overrides: Partial<MembershipEntitlementDeps> = {}) {
  const updateClerkPublicMetadata = vi.fn(
    overrides.updateClerkPublicMetadata ?? (async () => undefined)
  );
  const syncSmsAudience = vi.fn(
    overrides.syncSmsAudience ?? (async () => undefined)
  );
  return {
    resolveStripeMembershipGrant:
      overrides.resolveStripeMembershipGrant ?? (async () => null),
    resolveAppleMembershipGrant:
      overrides.resolveAppleMembershipGrant ?? (async () => null),
    updateClerkPublicMetadata,
    syncSmsAudience,
  };
}

describe("resolveStripeMembershipGrantFromSubscription", () => {
  it("active monthly grants", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({ status: "active" })
      )
    ).toEqual(stripeGrant({ plan: "monthly" }));
  });

  it("trialing grants", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({ status: "trialing" })
      )
    ).toEqual(stripeGrant({ plan: "monthly" }));
  });

  it("active annual grants annual plan", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_year",
                  recurring: { interval: "year" },
                },
              },
            ],
          },
        })
      )
    ).toEqual(stripeGrant({ plan: "annual" }));
  });

  it("pause_collection does not grant and projects paused", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({
          status: "active",
          pause_collection: { behavior: "mark_uncollectible" },
        })
      )
    ).toEqual(stripeGrant({ grantsAccess: false, plan: "paused" }));
  });

  it("past_due does not grant (current production entitlement law)", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({ status: "past_due" })
      )
    ).toEqual(stripeGrant({ grantsAccess: false, plan: null }));
  });

  it("canceled / deleted-equivalent does not grant", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({ status: "canceled" })
      )
    ).toEqual(stripeGrant({ grantsAccess: false, plan: null }));
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({ status: "incomplete_expired" })
      )
    ).toEqual(stripeGrant({ grantsAccess: false, plan: null }));
  });

  it("missing subscription is no Stripe evidence", () => {
    expect(resolveStripeMembershipGrantFromSubscription(null)).toBeNull();
    expect(resolveStripeMembershipGrantFromSubscription(undefined)).toBeNull();
  });

  it("entitled unknown interval grants with null plan", () => {
    expect(
      resolveStripeMembershipGrantFromSubscription(
        stripeSub({
          status: "active",
          items: { data: [{ price: { id: "price_x", recurring: null } }] },
        })
      )
    ).toEqual(stripeGrant({ plan: null }));
  });
});

describe("Apple expiry and row grant law", () => {
  it("active future expires_at grants", () => {
    expect(isAppleRowCurrentlyGranting(appleRow(), NOW)).toBe(true);
  });

  it("active row with expired expires_at does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ expires_at: PAST }), NOW)
    ).toBe(false);
  });

  it("active row with expires_at equal to now does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(
        appleRow({ expires_at: NOW.toISOString() }),
        NOW
      )
    ).toBe(false);
  });

  it("active row with null expires_at does not grant (fail closed)", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ expires_at: null }), NOW)
    ).toBe(false);
  });

  it("grace_period grants while period valid", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ status: "grace_period" }), NOW)
    ).toBe(true);
    expect(
      isAppleRowCurrentlyGranting(
        appleRow({ status: "grace_period", expires_at: PAST }),
        NOW
      )
    ).toBe(false);
  });

  it("billing_retry grants while period valid", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ status: "billing_retry" }), NOW)
    ).toBe(true);
    expect(
      isAppleRowCurrentlyGranting(
        appleRow({ status: "billing_retry", expires_at: PAST }),
        NOW
      )
    ).toBe(false);
  });

  it("refunded does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ status: "refunded" }), NOW)
    ).toBe(false);
  });

  it("revoked does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ status: "revoked" }), NOW)
    ).toBe(false);
  });

  it("expired status does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(appleRow({ status: "expired" }), NOW)
    ).toBe(false);
  });

  it("wrong Apple product ID does not grant", () => {
    expect(
      isAppleRowCurrentlyGranting(
        appleRow({ product_id: "com.summittmindset.ios.membership.annual" }),
        NOW
      )
    ).toBe(false);
  });
});

describe("resolveAppleMembershipGrantFromRecords — multiple rows", () => {
  it("any one valid row grants; invalid rows do not cancel it", () => {
    expect(
      resolveAppleMembershipGrantFromRecords(
        [
          appleRow({ status: "refunded" }),
          appleRow({ product_id: "wrong.product" }),
          appleRow({ expires_at: PAST }),
          appleRow({ status: "active", expires_at: FUTURE }),
        ],
        NOW
      )
    ).toEqual(appleGrant());
  });

  it("all invalid rows do not grant", () => {
    expect(
      resolveAppleMembershipGrantFromRecords(
        [
          appleRow({ status: "expired" }),
          appleRow({ status: "refunded" }),
          appleRow({ status: "revoked" }),
          appleRow({ expires_at: PAST }),
          appleRow({ product_id: "wrong.product" }),
        ],
        NOW
      )
    ).toBeNull();
  });

  it("empty rows do not grant", () => {
    expect(resolveAppleMembershipGrantFromRecords([], NOW)).toBeNull();
  });
});

describe("combineMembershipGrants matrix", () => {
  const cases: Array<{
    name: string;
    stripe: MembershipGrant | null;
    apple: MembershipGrant | null;
    expected: MembershipProjection;
  }> = [
    {
      name: "1. Stripe active + no Apple",
      stripe: stripeGrant({ plan: "monthly" }),
      apple: null,
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "stripe",
      },
    },
    {
      name: "1b. Stripe active annual + no Apple",
      stripe: stripeGrant({ plan: "annual" }),
      apple: null,
      expected: {
        summittSubscribed: true,
        summittPlan: "annual",
        summittPaymentSource: "stripe",
      },
    },
    {
      name: "2. Stripe trialing + no Apple",
      stripe: stripeGrant({ plan: "monthly" }),
      apple: null,
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "stripe",
      },
    },
    {
      name: "3. Stripe paused + no Apple",
      stripe: stripeGrant({ grantsAccess: false, plan: "paused" }),
      apple: null,
      expected: {
        summittSubscribed: false,
        summittPlan: "paused",
        summittPaymentSource: null,
      },
    },
    {
      name: "4. Stripe inactive + no Apple",
      stripe: stripeGrant({ grantsAccess: false, plan: null }),
      apple: null,
      expected: {
        summittSubscribed: false,
        summittPlan: null,
        summittPaymentSource: null,
      },
    },
    {
      name: "4b. No Stripe + no Apple",
      stripe: null,
      apple: null,
      expected: {
        summittSubscribed: false,
        summittPlan: null,
        summittPaymentSource: null,
      },
    },
    {
      name: "5. No Stripe + Apple active",
      stripe: null,
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "apple",
      },
    },
    {
      name: "6. No Stripe + Apple grace_period",
      stripe: null,
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "apple",
      },
    },
    {
      name: "7. No Stripe + Apple billing_retry",
      stripe: null,
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "apple",
      },
    },
    {
      name: "8. No Stripe + Apple expired/refunded/revoked",
      stripe: null,
      apple: null,
      expected: {
        summittSubscribed: false,
        summittPlan: null,
        summittPaymentSource: null,
      },
    },
    {
      name: "9. Stripe active + Apple active → multiple; Stripe plan wins",
      stripe: stripeGrant({ plan: "annual" }),
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "annual",
        summittPaymentSource: "multiple",
      },
    },
    {
      name: "9b. Stripe active monthly + Apple active → multiple",
      stripe: stripeGrant({ plan: "monthly" }),
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "multiple",
      },
    },
    {
      name: "10. Stripe paused + Apple active → access monthly (Apple)",
      stripe: stripeGrant({ grantsAccess: false, plan: "paused" }),
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "apple",
      },
    },
    {
      name: "11. Stripe inactive + Apple active",
      stripe: stripeGrant({ grantsAccess: false, plan: null }),
      apple: appleGrant(),
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "apple",
      },
    },
    {
      name: "12. Stripe active + Apple inactive",
      stripe: stripeGrant({ plan: "monthly" }),
      apple: null,
      expected: {
        summittSubscribed: true,
        summittPlan: "monthly",
        summittPaymentSource: "stripe",
      },
    },
    {
      name: "13. Neither grants",
      stripe: stripeGrant({ grantsAccess: false, plan: null }),
      apple: null,
      expected: {
        summittSubscribed: false,
        summittPlan: null,
        summittPaymentSource: null,
      },
    },
  ];

  it.each(cases)("$name", ({ stripe, apple, expected }) => {
    expect(combineMembershipGrants(stripe, apple)).toEqual(expected);
  });
});

describe("recomputeSummittMembershipEntitlement", () => {
  it("writes Clerk then SMS on success and returns projection", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant({ plan: "annual" }),
      resolveAppleMembershipGrant: async () => null,
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: true,
      summittSubscribed: true,
      summittPlan: "annual",
      summittPaymentSource: "stripe",
    });
    expect(deps.updateClerkPublicMetadata).toHaveBeenCalledTimes(1);
    expect(deps.updateClerkPublicMetadata).toHaveBeenCalledWith(USER_ID, {
      summittSubscribed: true,
      summittPlan: "annual",
    });
    expect(deps.syncSmsAudience).toHaveBeenCalledTimes(1);
    expect(deps.syncSmsAudience).toHaveBeenCalledWith({
      userId: USER_ID,
      summittSubscribed: true,
    });
    const clerkOrder = deps.updateClerkPublicMetadata.mock.invocationCallOrder[0];
    const smsOrder = deps.syncSmsAudience.mock.invocationCallOrder[0];
    expect(clerkOrder).toBeLessThan(smsOrder);
  });

  it("does not write summittPaymentSource to Clerk (deferred display field)", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant(),
      resolveAppleMembershipGrant: async () => appleGrant(),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summittPaymentSource).toBe("multiple");
    }
    expect(deps.updateClerkPublicMetadata).toHaveBeenCalledWith(USER_ID, {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(deps.updateClerkPublicMetadata.mock.calls[0][1]).not.toHaveProperty(
      "summittPaymentSource"
    );
  });

  it("Stripe lookup throws → no Clerk/SMS writes", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => {
        throw new Error("Stripe API unavailable");
      },
      resolveAppleMembershipGrant: async () => appleGrant(),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "stripe_lookup_failed",
      clerkUpdated: false,
    });
    expect(deps.updateClerkPublicMetadata).not.toHaveBeenCalled();
    expect(deps.syncSmsAudience).not.toHaveBeenCalled();
  });

  it("Apple lookup throws → no Clerk/SMS writes", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant(),
      resolveAppleMembershipGrant: async () => {
        throw new Error("Supabase unavailable");
      },
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "apple_lookup_failed",
      clerkUpdated: false,
    });
    expect(deps.updateClerkPublicMetadata).not.toHaveBeenCalled();
    expect(deps.syncSmsAudience).not.toHaveBeenCalled();
  });

  it("Clerk projection update throws → no SMS write", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant(),
      updateClerkPublicMetadata: vi.fn(async () => {
        throw new Error("Clerk down");
      }),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "clerk_projection_failed",
      clerkUpdated: false,
    });
    expect(deps.syncSmsAudience).not.toHaveBeenCalled();
  });

  it("SMS sync throws after Clerk success → retryable, Clerk already updated", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant(),
      syncSmsAudience: vi.fn(async () => {
        throw new Error("sms replica failed");
      }),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "sms_sync_failed",
      clerkUpdated: true,
    });
    expect(deps.updateClerkPublicMetadata).toHaveBeenCalledTimes(1);
  });

  it("paused Stripe + valid Apple → active monthly and writes subscribed true", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () =>
        stripeGrant({ grantsAccess: false, plan: "paused" }),
      resolveAppleMembershipGrant: async () => appleGrant(),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
    expect(deps.updateClerkPublicMetadata).toHaveBeenCalledWith(USER_ID, {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(deps.syncSmsAudience).toHaveBeenCalledWith({
      userId: USER_ID,
      summittSubscribed: true,
    });
  });

  it("both Stripe and Apple active → multiple / subscribed", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant({ plan: "annual" }),
      resolveAppleMembershipGrant: async () => appleGrant(),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: true,
      summittSubscribed: true,
      summittPlan: "annual",
      summittPaymentSource: "multiple",
    });
  });

  it("is idempotent for identical input", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => stripeGrant({ plan: "monthly" }),
      resolveAppleMembershipGrant: async () => null,
    });

    const first = await recomputeSummittMembershipEntitlement(USER_ID, deps);
    const second = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(first).toEqual(second);
    expect(deps.updateClerkPublicMetadata.mock.calls).toEqual([
      [USER_ID, { summittSubscribed: true, summittPlan: "monthly" }],
      [USER_ID, { summittSubscribed: true, summittPlan: "monthly" }],
    ]);
    expect(deps.syncSmsAudience.mock.calls).toEqual([
      [{ userId: USER_ID, summittSubscribed: true }],
      [{ userId: USER_ID, summittSubscribed: true }],
    ]);
  });

  it("Apple resolver using records: expired active row does not grant", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => null,
      resolveAppleMembershipGrant: async () =>
        resolveAppleMembershipGrantFromRecords(
          [appleRow({ status: "active", expires_at: PAST })],
          NOW
        ),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: true,
      summittSubscribed: false,
      summittPlan: null,
      summittPaymentSource: null,
    });
  });

  it("Apple resolver using records: future expires_at grants", async () => {
    const deps = makeDeps({
      resolveStripeMembershipGrant: async () => null,
      resolveAppleMembershipGrant: async () =>
        resolveAppleMembershipGrantFromRecords([appleRow()], NOW),
    });

    const result = await recomputeSummittMembershipEntitlement(USER_ID, deps);

    expect(result).toEqual({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
  });
});

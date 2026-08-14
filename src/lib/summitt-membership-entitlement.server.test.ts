import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const appleEqMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "apple_subscriptions") {
        return {
          select: () => ({
            eq: (...args: unknown[]) => appleEqMock(...args),
          }),
        };
      }
      return {};
    },
  },
}));

const updateClerkMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));

const syncSmsMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsMock(...args),
}));

import {
  createMembershipEntitlementDeps,
  isRetryableMembershipSourceOrClerkFailure,
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromAuthoritativeStripeSubscription,
  resolveAppleMembershipGrantForUser,
} from "./summitt-membership-entitlement.server";

const FUTURE = "2026-12-01T00:00:00.000Z";
const APPLE_PRODUCT = "com.summittmindset.ios.membership.monthly";

function stripeActive() {
  return {
    status: "active",
    pause_collection: null,
    items: {
      data: [{ price: { recurring: { interval: "month" as const } } }],
    },
  };
}

describe("summitt-membership-entitlement.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appleEqMock.mockResolvedValue({ data: [], error: null });
    updateClerkMock.mockResolvedValue(undefined);
    syncSmsMock.mockResolvedValue(undefined);
  });

  it("empty Apple rows are no grant, not infrastructure failure", async () => {
    await expect(
      resolveAppleMembershipGrantForUser("user_1")
    ).resolves.toBeNull();
  });

  it("Apple query error throws (retryable)", async () => {
    appleEqMock.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    await expect(resolveAppleMembershipGrantForUser("user_1")).rejects.toThrow(
      /apple_subscriptions lookup failed/
    );
  });

  it("valid Apple row grants monthly", async () => {
    appleEqMock.mockResolvedValue({
      data: [
        {
          product_id: APPLE_PRODUCT,
          status: "active",
          expires_at: FUTURE,
        },
      ],
      error: null,
    });
    await expect(resolveAppleMembershipGrantForUser("user_1")).resolves.toEqual({
      grantsAccess: true,
      plan: "monthly",
      source: "apple",
    });
  });

  it("uses the supplied Stripe subscription, not a Clerk id refetch", async () => {
    const deps = createMembershipEntitlementDeps({
      stripeSubscription: stripeActive(),
    });
    await expect(deps.resolveStripeMembershipGrant("ignored")).resolves.toEqual({
      grantsAccess: true,
      plan: "monthly",
      source: "stripe",
    });
  });

  it("recompute Stripe-only active writes Clerk then SMS", async () => {
    const result = await recomputeMembershipFromAuthoritativeStripeSubscription(
      "user_1",
      stripeActive()
    );
    expect(result).toMatchObject({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(syncSmsMock).toHaveBeenCalledWith({
      userId: "user_1",
      summittSubscribed: true,
    });
  });

  it("classifies source/Clerk failures as retryable and SMS-after-Clerk as not", () => {
    expect(
      isRetryableMembershipSourceOrClerkFailure({
        ok: false,
        retryable: true,
        reason: "apple_lookup_failed",
        clerkUpdated: false,
      })
    ).toBe(true);
    expect(
      isRetryableMembershipSourceOrClerkFailure({
        ok: false,
        retryable: true,
        reason: "sms_sync_failed",
        clerkUpdated: true,
      })
    ).toBe(false);
    expect(
      membershipProjectionClerkSucceeded({
        ok: false,
        retryable: true,
        reason: "sms_sync_failed",
        clerkUpdated: true,
      })
    ).toBe(true);
  });
});

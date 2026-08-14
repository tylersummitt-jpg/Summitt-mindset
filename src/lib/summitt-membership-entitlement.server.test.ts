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

const getClerkMetadataMock = vi.fn();
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkMetadataMock(...args),
}));

import {
  createMembershipEntitlementDeps,
  isRetryableMembershipSourceOrClerkFailure,
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromAuthoritativeStripeSubscription,
  recomputeMembershipFromDurableSources,
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
    getClerkMetadataMock.mockResolvedValue({});
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

describe("recomputeMembershipFromDurableSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appleEqMock.mockResolvedValue({ data: [], error: null });
    updateClerkMock.mockResolvedValue(undefined);
    syncSmsMock.mockResolvedValue(undefined);
    getClerkMetadataMock.mockResolvedValue({});
  });
  it("Apple-only active grants membership when Clerk has no Stripe id", async () => {
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
    getClerkMetadataMock.mockResolvedValue({});
    const retrieve = vi.fn();
    const result = await recomputeMembershipFromDurableSources("user_1", {
      retrieveStripeSubscription: retrieve,
      readClerkPublicMetadata: getClerkMetadataMock,
    });
    expect(result).toMatchObject({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("missing stripeSubscriptionId is no Stripe grant, not a lookup failure", async () => {
    getClerkMetadataMock.mockResolvedValue({ stripeSubscriptionId: "" });
    const retrieve = vi.fn(async () => {
      throw new Error("should not retrieve");
    });
    const result = await recomputeMembershipFromDurableSources("user_1", {
      retrieveStripeSubscription: retrieve,
      readClerkPublicMetadata: getClerkMetadataMock,
    });
    expect(result).toMatchObject({
      ok: true,
      summittSubscribed: false,
      summittPlan: null,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("Stripe retrieve throw is retryable and does not write Clerk false", async () => {
    getClerkMetadataMock.mockResolvedValue({
      stripeSubscriptionId: "sub_live",
    });
    const result = await recomputeMembershipFromDurableSources("user_1", {
      retrieveStripeSubscription: async () => {
        throw new Error("stripe down");
      },
      readClerkPublicMetadata: getClerkMetadataMock,
    });
    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "stripe_lookup_failed",
      clerkUpdated: false,
    });
    expect(updateClerkMock).not.toHaveBeenCalled();
  });

  it("Stripe OR Apple: canceled Stripe plus active Apple still grants", async () => {
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
    getClerkMetadataMock.mockResolvedValue({
      stripeSubscriptionId: "sub_canceled",
    });
    const result = await recomputeMembershipFromDurableSources("user_1", {
      retrieveStripeSubscription: async () => ({
        status: "canceled",
        pause_collection: null,
        items: { data: [] },
      }),
      readClerkPublicMetadata: getClerkMetadataMock,
    });
    expect(result).toMatchObject({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
    });
  });

  it("Stripe OR Apple: active Stripe plus empty Apple still grants", async () => {
    getClerkMetadataMock.mockResolvedValue({
      stripeSubscriptionId: "sub_active",
    });
    const result = await recomputeMembershipFromDurableSources("user_1", {
      retrieveStripeSubscription: async () => stripeActive(),
      readClerkPublicMetadata: getClerkMetadataMock,
    });
    expect(result).toMatchObject({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
    });
  });
});

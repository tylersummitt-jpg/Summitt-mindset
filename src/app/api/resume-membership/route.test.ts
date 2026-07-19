import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

const updateClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) =>
    updateClerkPublicMetadataMock(...args),
}));

const syncSmsAudienceMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsAudienceMock(...args),
}));

const assertDeletionMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  ACCOUNT_DELETION_IN_PROGRESS_BODY: {
    error: "account_deletion_in_progress",
    message: "This action is unavailable.",
  },
  assertEntitlementMutationAllowedForAccountDeletion: (...args: unknown[]) =>
    assertDeletionMock(...args),
}));

const retrieveMock = vi.fn();
const updateMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    };
  }
  return { default: StripeMock };
});

function pausedSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_paused",
    status: "active",
    pause_collection: { behavior: "mark_uncollectible" },
    customer: "cus_1",
    metadata: { userId: "user_1", plan: "monthly" },
    items: {
      data: [
        {
          price: {
            id: "price_legacy_monthly",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("POST /api/resume-membership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_resume";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: {
        stripeSubscriptionId: "sub_paused",
        stripeCustomerId: "cus_1",
        phoneNumber: "+15551234567",
        smsEnabled: true,
        timezone: "America/New_York",
        smsTimePreference: "morning",
        summittPlan: "paused",
        summittSubscribed: false,
      },
    });
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
    syncSmsAudienceMock.mockResolvedValue(undefined);
    assertDeletionMock.mockResolvedValue({ ok: true });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns no_subscription when Clerk lacks stripeSubscriptionId", async () => {
    currentUserMock.mockResolvedValue({ publicMetadata: {} });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "no_subscription" });
  });

  it("returns ownership_mismatch when customer IDs differ", async () => {
    retrieveMock.mockResolvedValue(pausedSub({ customer: "cus_other" }));
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: "ownership_mismatch" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns ownership_mismatch when metadata.userId differs", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({ metadata: { userId: "user_other", plan: "monthly" } })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: "ownership_mismatch" });
  });

  it("returns subscription_not_recoverable for canceled", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({ status: "canceled", pause_collection: null })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      code: "subscription_not_recoverable",
    });
  });

  it("already_active heals stale paused Clerk/SMS without Stripe update", async () => {
    // Proven defect: Stripe already unpaused after prior partial failure;
    // Clerk still says paused/false. Retry must reconcile local state.
    retrieveMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      code: "already_active",
      plan: "monthly",
      entitled: true,
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_paused",
    });

    expect(syncSmsAudienceMock).toHaveBeenCalledTimes(1);
    const smsArgs = syncSmsAudienceMock.mock.calls[0][0];
    expect(smsArgs).toMatchObject({
      userId: "user_1",
      summittSubscribed: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      timezone: "America/New_York",
    });
    expect(smsArgs).not.toHaveProperty("stoppedAt");
  });

  it("already_active annual heals Clerk to annual plan", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({
        pause_collection: null,
        status: "active",
        metadata: { userId: "user_1", plan: "annual" },
        items: {
          data: [
            {
              price: {
                id: "price_legacy_annual",
                recurring: { interval: "year" },
              },
            },
          ],
        },
      })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      code: "already_active",
      plan: "annual",
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        summittSubscribed: true,
        summittPlan: "annual",
        stripeSubscriptionId: "sub_paused",
        stripeCustomerId: "cus_1",
      })
    );
  });

  it("already_active + Clerk failure returns clerk_error without Stripe mutation", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    updateClerkPublicMetadataMock.mockRejectedValue(new Error("clerk down"));
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "clerk_error" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });

  it("already_active + SMS failure still returns success (non-fatal)", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    syncSmsAudienceMock.mockRejectedValue(new Error("sms sync down"));
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      code: "already_active",
    });
    expect(updateClerkPublicMetadataMock).toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns not_paused when unpaused and not entitled without reconcile as active", async () => {
    retrieveMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "past_due" })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "not_paused" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });

  it("resumes paused monthly: Stripe mutation, Clerk, SMS", async () => {
    retrieveMock.mockResolvedValue(pausedSub());
    updateMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      code: "resumed",
      plan: "monthly",
      entitled: true,
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith("sub_paused", {
      pause_collection: null,
    });
    const updatePayload = updateMock.mock.calls[0][1];
    expect(updatePayload).not.toHaveProperty("items");
    expect(updatePayload).not.toHaveProperty("price");
    expect(updatePayload).not.toHaveProperty("proration_behavior");

    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_paused",
    });
    expect(syncSmsAudienceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        summittSubscribed: true,
        smsEnabled: true,
        phoneNumber: "+15551234567",
      })
    );
    expect(syncSmsAudienceMock.mock.calls[0][0]).not.toHaveProperty("stoppedAt");
  });

  it("resumes paused annual with annual plan", async () => {
    const annual = pausedSub({
      metadata: { userId: "user_1", plan: "annual" },
      items: {
        data: [
          {
            price: {
              id: "price_legacy_annual",
              recurring: { interval: "year" },
            },
          },
        ],
      },
    });
    retrieveMock.mockResolvedValue(annual);
    updateMock.mockResolvedValue({ ...annual, pause_collection: null });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        summittSubscribed: true,
        summittPlan: "annual",
        stripeSubscriptionId: "sub_paused",
      })
    );
  });

  it("Stripe update failure does not mutate Clerk or SMS", async () => {
    retrieveMock.mockResolvedValue(pausedSub());
    updateMock.mockRejectedValue(new Error("stripe down"));
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, code: "stripe_error" });
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });

  it("Clerk failure after Stripe success does not re-pause", async () => {
    retrieveMock.mockResolvedValue(pausedSub());
    updateMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    updateClerkPublicMetadataMock.mockRejectedValue(new Error("clerk down"));
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "clerk_error" });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][1]).toEqual({ pause_collection: null });
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });

  it("B3b: unresolved deletion → 409, no Stripe call, no Clerk unlock", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "account_deletion_in_progress",
      ok: false,
    });
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });

  it("B3b: deletion lookup failure → 500 fail closed", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(500);
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("10. second-check race: Stripe may resume, second check blocks → no Clerk/SMS unlock", async () => {
    assertDeletionMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({
        ok: false,
        code: "account_deletion_in_progress",
      });
    retrieveMock.mockResolvedValue(pausedSub());
    updateMock.mockResolvedValue(
      pausedSub({ pause_collection: null, status: "active" })
    );
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "account_deletion_in_progress",
      ok: false,
    });
    expect(updateMock).toHaveBeenCalledWith("sub_paused", {
      pause_collection: null,
    });
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });
});

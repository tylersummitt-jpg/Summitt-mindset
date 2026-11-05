import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

const appleEqMock = vi.fn();
const insertMock = vi.fn(
  async (_payload?: unknown): Promise<{ error: { code: string } | null }> => ({
    error: null,
  })
);
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
      return {
        insert: (payload: unknown) => insertMock(payload),
      };
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

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  ACCOUNT_DELETION_IN_PROGRESS_BODY: {
    error: "account_deletion_in_progress",
    message: "This action is unavailable.",
  },
  assertEntitlementMutationAllowedForAccountDeletion: vi.fn(async () => ({
    ok: true,
  })),
}));

const cancelMock = vi.fn();
const retrieveMock = vi.fn();
const updateSubMock = vi.fn();
vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      cancel: (...args: unknown[]) => cancelMock(...args),
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      update: (...args: unknown[]) => updateSubMock(...args),
    };
  }
  return { default: StripeMock };
});

const APPLE_PRODUCT = "com.summittmindset.ios.membership.monthly";
const FUTURE = "2026-12-01T00:00:00.000Z";

function activeSub() {
  return {
    id: "sub_1",
    status: "active",
    pause_collection: null,
    customer: "cus_1",
    items: {
      data: [{ price: { recurring: { interval: "month" } } }],
    },
  };
}

function canceledSub() {
  return {
    id: "sub_1",
    status: "canceled",
    pause_collection: null,
    customer: "cus_1",
    items: { data: [] },
  };
}

function pausedSub() {
  return {
    id: "sub_1",
    status: "active",
    pause_collection: { behavior: "mark_uncollectible" },
    customer: "cus_1",
    items: {
      data: [{ price: { recurring: { interval: "month" } } }],
    },
  };
}

describe("cancel / pause membership Phase 3 recompute", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_churn";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: { stripeSubscriptionId: "sub_1" },
    });
    appleEqMock.mockResolvedValue({ data: [], error: null });
    retrieveMock.mockResolvedValue(activeSub());
    insertMock.mockResolvedValue({ error: null });
    updateClerkMock.mockResolvedValue(undefined);
    syncSmsMock.mockResolvedValue(undefined);
  });

  it("cancel Stripe-only → false/null using cancel response", async () => {
    cancelMock.mockResolvedValue(canceledSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "other", message: null }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelMock).toHaveBeenCalledWith("sub_1");
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: null,
    });
  });

  it("cancel + Apple active → still subscribed monthly", async () => {
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
    cancelMock.mockResolvedValue(canceledSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "other", message: null }),
      })
    );
    expect(res.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
  });

  it("does not cancel or record feedback when Stripe already canceled", async () => {
    currentUserMock.mockResolvedValue({
      publicMetadata: {
        stripeSubscriptionId: "sub_1",
        summittSubscribed: true,
        summittPlan: "monthly",
      },
    });
    retrieveMock.mockResolvedValue(canceledSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", {
        method: "POST",
        body: JSON.stringify({
          reasonCode: "not_using",
          message: "hello",
          skippedReason: false,
          skippedComment: false,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: null,
    });
  });

  it("keeps Apple access when Stripe is already canceled", async () => {
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
    retrieveMock.mockResolvedValue(canceledSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
  });

  it("returns billing success when already-canceled reconciliation cannot update Clerk", async () => {
    retrieveMock.mockResolvedValue(canceledSub());
    updateClerkMock.mockRejectedValue(new Error("clerk down"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not clear access when Apple cannot be read for an already-canceled subscription", async () => {
    retrieveMock.mockResolvedValue(canceledSub());
    appleEqMock.mockResolvedValue({ data: null, error: { message: "apple down" } });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateClerkMock).not.toHaveBeenCalled();
  });

  it("does not record feedback when Stripe cancel fails", async () => {
    cancelMock.mockRejectedValue(new Error("stripe down"));
    retrieveMock.mockResolvedValue(activeSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(500);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns success without a second feedback row when cancel throws but Stripe is already canceled", async () => {
    cancelMock.mockRejectedValue(new Error("already canceled"));
    retrieveMock
      .mockResolvedValueOnce(activeSub())
      .mockResolvedValueOnce(canceledSub());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: null,
    });
  });

  it("returns success when Clerk projection throws after Stripe cancel", async () => {
    cancelMock.mockResolvedValue(canceledSub());
    updateClerkMock.mockRejectedValue(new Error("clerk down"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", {
        method: "POST",
        body: JSON.stringify({
          reasonCode: "too_expensive",
          message: "  price  ",
          skippedReason: false,
          skippedComment: false,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason_code: "too_expensive",
        message: "price",
        moment: "cancel_attempt",
        metadata: expect.objectContaining({
          survey_version: 2,
          confirmed_stripe_cancel: true,
          skipped_reason: false,
        }),
      })
    );
  });

  it("returns success when feedback insert fails", async () => {
    cancelMock.mockResolvedValue(canceledSub());
    insertMock.mockResolvedValue({ error: { code: "42501" } });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cancelMock).toHaveBeenCalledWith("sub_1");
  });
});

describe("pause-membership Phase 3 recompute", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_churn";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: { stripeSubscriptionId: "sub_1" },
    });
    appleEqMock.mockResolvedValue({ data: [], error: null });
    updateClerkMock.mockResolvedValue(undefined);
    syncSmsMock.mockResolvedValue(undefined);
  });

  it("pause Stripe-only uses update response → false/paused", async () => {
    updateSubMock.mockResolvedValue(pausedSub());
    const { POST } = await import("../pause-membership/route");
    const res = await POST(
      new Request("http://localhost/api/pause-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      pause_collection: { behavior: "mark_uncollectible" },
    });
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: "paused",
    });
  });

  it("pause + Apple active → true/monthly", async () => {
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
    updateSubMock.mockResolvedValue(pausedSub());
    const { POST } = await import("../pause-membership/route");
    const res = await POST(
      new Request("http://localhost/api/pause-membership", { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
  });
});

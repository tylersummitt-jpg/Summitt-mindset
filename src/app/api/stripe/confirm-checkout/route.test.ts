import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) =>
    getClerkPublicMetadataMock(...args),
}));

const updateClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) =>
    updateClerkPublicMetadataMock(...args),
}));

const syncSmsMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsMock(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "apple_subscriptions") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      return {};
    },
  },
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

const retrieveSessionMock = vi.fn();
const retrieveSubMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
      },
    };
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
    };
  }
  return { default: StripeMock };
});

describe("POST /api/stripe/confirm-checkout B3b", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_confirm";
    authMock.mockResolvedValue({ userId: "user_1" });
    assertDeletionMock.mockResolvedValue({ ok: true });
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
    getClerkPublicMetadataMock.mockResolvedValue({});
    syncSmsMock.mockResolvedValue(undefined);
  });

  it("unresolved deletion → 409, no Stripe retrieve, no entitlement write", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/confirm-checkout", {
        method: "POST",
        body: JSON.stringify({ sessionId: "cs_1" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account_deletion_in_progress",
      message: "This action is unavailable.",
    });
    expect(retrieveSessionMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });

  it("lookup failure → 500 fail closed", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/confirm-checkout", {
        method: "POST",
        body: JSON.stringify({ sessionId: "cs_1" }),
      })
    );
    expect(res.status).toBe(500);
    expect(retrieveSessionMock).not.toHaveBeenCalled();
  });

  it("ordinary user → entitlement write preserved", async () => {
    retrieveSessionMock.mockResolvedValue({
      id: "cs_1",
      client_reference_id: "user_1",
      subscription: "sub_1",
      customer: "cus_1",
    });
    retrieveSubMock.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      items: {
        data: [{ price: { recurring: { interval: "month" } } }],
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/confirm-checkout", {
        method: "POST",
        body: JSON.stringify({ sessionId: "cs_1" }),
      })
    );
    expect(res.status).toBe(200);
    expect(assertDeletionMock).toHaveBeenCalledTimes(2);
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    expect(retrieveSubMock).toHaveBeenCalledWith("sub_1");
    expect(syncSmsMock).toHaveBeenCalledWith({
      userId: "user_1",
      summittSubscribed: true,
    });
  });

  it("9. second-check race: first allowed, second blocks → no entitlement write", async () => {
    assertDeletionMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({
        ok: false,
        code: "account_deletion_in_progress",
      });
    retrieveSessionMock.mockResolvedValue({
      id: "cs_1",
      client_reference_id: "user_1",
      subscription: "sub_1",
      customer: "cus_1",
    });
    retrieveSubMock.mockResolvedValue({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      items: {
        data: [{ price: { recurring: { interval: "month" } } }],
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/confirm-checkout", {
        method: "POST",
        body: JSON.stringify({ sessionId: "cs_1" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account_deletion_in_progress",
      message: "This action is unavailable.",
    });
    expect(retrieveSessionMock).toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });
});

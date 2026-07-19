import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const deleteEqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "stripe_webhook_events") {
        return {
          insert: (...args: unknown[]) => insertMock(...args),
          delete: () => deleteMock(),
        };
      }
      return {
        insert: (...args: unknown[]) => insertMock(...args),
        delete: () => deleteMock(),
      };
    },
  },
}));

const releaseDedupeMock = vi.fn();
vi.mock("@/lib/stripe-webhook-dedupe", () => ({
  releaseStripeWebhookEventDedupe: (...args: unknown[]) =>
    releaseDedupeMock(...args),
}));

const updateClerkMock = vi.fn();
const getClerkMdMock = vi.fn();
const getClerkUserMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkMdMock(...args),
  getClerkUser: (...args: unknown[]) => getClerkUserMock(...args),
}));

const syncSmsMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsMock(...args),
}));

vi.mock("@/lib/notify-coach-subscribed", () => ({
  notifyCoachSubscribedInternal: vi.fn(),
}));
vi.mock("@/lib/notify-member-subscribed", () => ({
  notifyMemberSubscribedInternal: vi.fn(),
}));

const evaluateUnlockMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  evaluateEntitlementIncreasingWebhookWrite: (...args: unknown[]) =>
    evaluateUnlockMock(...args),
}));

const constructEventMock = vi.fn();
const retrieveSubMock = vi.fn();
const updateCustomerMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    webhooks = {
      constructEvent: (...args: unknown[]) => constructEventMock(...args),
    };
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
    };
    customers = {
      update: (...args: unknown[]) => updateCustomerMock(...args),
      retrieve: vi.fn(),
    };
    checkout = { sessions: { list: vi.fn(async () => ({ data: [] })) } };
  }
  return { default: StripeMock };
});

function webhookReq(body = "{}") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": "sig_test" },
  });
}

function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    pause_collection: null,
    customer: "cus_1",
    metadata: { userId: "user_1" },
    items: {
      data: [{ price: { recurring: { interval: "month" } } }],
    },
    ...overrides,
  };
}

describe("Stripe webhook B3b anti-resurrection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_wh";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CLERK_SECRET_KEY = "sk_clerk";
    insertMock.mockResolvedValue({ error: null });
    deleteEqMock.mockResolvedValue({ error: null });
    releaseDedupeMock.mockResolvedValue({ ok: true });
    evaluateUnlockMock.mockResolvedValue({ decision: "allowed" });
    updateClerkMock.mockResolvedValue(undefined);
    getClerkMdMock.mockResolvedValue({});
    syncSmsMock.mockResolvedValue(undefined);
  });

  it("1. entitlement-increasing + deletion row → 200, no unlock, dedupe retained", async () => {
    evaluateUnlockMock.mockResolvedValue({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(syncSmsMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith({ event_id: "evt_1" });
  });

  it("2. entitlement-increasing + lookup_failed → 500, release current dedupe, retry succeeds", async () => {
    evaluateUnlockMock
      .mockResolvedValueOnce({ decision: "lookup_failed" })
      .mockResolvedValue({ decision: "allowed" });
    retrieveSubMock.mockResolvedValue(activeSub());
    constructEventMock.mockReturnValue({
      id: "evt_lookup_fail",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const failRes = await POST(webhookReq() as never);
    expect(failRes.status).toBe(500);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(syncSmsMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_lookup_fail");

    // Simulated retry after DB recovery (dedupe released, insert succeeds again)
    releaseDedupeMock.mockClear();
    updateClerkMock.mockClear();
    const retryRes = await POST(webhookReq() as never);
    expect(retryRes.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ summittSubscribed: true })
    );
  });

  it("3. dedupe cleanup targets only the current event id", async () => {
    evaluateUnlockMock.mockResolvedValue({ decision: "lookup_failed" });
    constructEventMock.mockReturnValue({
      id: "evt_only_this",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    await POST(webhookReq() as never);
    expect(releaseDedupeMock).toHaveBeenCalledTimes(1);
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_only_this");
    expect(releaseDedupeMock).not.toHaveBeenCalledWith("evt_other");
  });

  it("4. checkout.session.completed lookup_failed → 500, no Clerk/SMS", async () => {
    evaluateUnlockMock.mockResolvedValue({ decision: "lookup_failed" });
    constructEventMock.mockReturnValue({
      id: "evt_cs_lookup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(500);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(syncSmsMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_cs_lookup");
  });

  it("5. entitled subscription.updated lookup_failed → 500, no Clerk write", async () => {
    evaluateUnlockMock.mockResolvedValue({ decision: "lookup_failed" });
    constructEventMock.mockReturnValue({
      id: "evt_sub_lookup",
      type: "customer.subscription.updated",
      data: { object: activeSub() },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(500);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_sub_lookup");
  });

  it("6. entitled invoice.paid lookup_failed → 500, no Clerk write", async () => {
    evaluateUnlockMock.mockResolvedValue({ decision: "lookup_failed" });
    constructEventMock.mockReturnValue({
      id: "evt_inv_lookup",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          lines: { data: [{ subscription: "sub_1" }] },
        },
      },
    });
    retrieveSubMock.mockResolvedValue(activeSub());
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(500);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_inv_lookup");
  });

  it("7. non-entitled subscription.updated during deletion → false/null only", async () => {
    evaluateUnlockMock.mockResolvedValue({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    constructEventMock.mockReturnValue({
      id: "evt_sub_paused_del",
      type: "customer.subscription.updated",
      data: {
        object: activeSub({
          pause_collection: { behavior: "mark_uncollectible" },
          status: "active",
        }),
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: null,
    });
    expect(updateClerkMock).not.toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ summittPlan: "monthly" })
    );
    expect(updateClerkMock).not.toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ stripeSubscriptionId: expect.anything() })
    );
    expect(syncSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ summittSubscribed: false })
    );
    expect(releaseDedupeMock).not.toHaveBeenCalled();
  });

  it("8. non-entitled subscription.updated ordinary user → existing plan behavior", async () => {
    evaluateUnlockMock.mockResolvedValue({ decision: "allowed" });
    constructEventMock.mockReturnValue({
      id: "evt_sub_paused_ok",
      type: "customer.subscription.updated",
      data: {
        object: activeSub({
          pause_collection: { behavior: "mark_uncollectible" },
        }),
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        summittSubscribed: false,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      })
    );
    // pause_collection set → summittPlan not overwritten in ordinary path
    const patch = updateClerkMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.summittPlan).toBeUndefined();
  });

  it("11. second-check race on webhook increase → deletion → 200, dedupe retained", async () => {
    evaluateUnlockMock
      .mockResolvedValueOnce({ decision: "allowed" })
      .mockResolvedValue({
        decision: "blocked_due_to_deletion",
        scope: "unresolved",
      });
    retrieveSubMock.mockResolvedValue(activeSub());
    constructEventMock.mockReturnValue({
      id: "evt_race_block",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_race",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).not.toHaveBeenCalled();
  });

  it("12. second-check lookup failure on webhook → dedupe released, 500", async () => {
    evaluateUnlockMock
      .mockResolvedValueOnce({ decision: "allowed" })
      .mockResolvedValue({ decision: "lookup_failed" });
    retrieveSubMock.mockResolvedValue(activeSub());
    constructEventMock.mockReturnValue({
      id: "evt_race_lookup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_race2",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(500);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).toHaveBeenCalledWith("evt_race_lookup");
  });

  it("13. entitlement-decreasing events still apply false/null safely", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          status: "canceled",
          customer: "cus_1",
          metadata: { userId: "user_1" },
          items: { data: [] },
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(evaluateUnlockMock).not.toHaveBeenCalled();
    expect(updateClerkMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        summittSubscribed: false,
        summittPlan: null,
      })
    );
    expect(syncSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ summittSubscribed: false })
    );
  });

  it("customer.subscription.updated active during deletion → no unlock", async () => {
    evaluateUnlockMock.mockResolvedValue({
      decision: "blocked_due_to_deletion",
      scope: "completed",
    });
    constructEventMock.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: activeSub() },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(syncSmsMock).not.toHaveBeenCalled();
    expect(releaseDedupeMock).not.toHaveBeenCalled();
  });

  it("invoice.paid entitled during deletion → no unlock", async () => {
    evaluateUnlockMock.mockResolvedValue({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    constructEventMock.mockReturnValue({
      id: "evt_3",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          lines: { data: [{ subscription: "sub_1" }] },
        },
      },
    });
    retrieveSubMock.mockResolvedValue(activeSub());
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(syncSmsMock).not.toHaveBeenCalled();
  });

  it("ordinary checkout.session.completed still unlocks", async () => {
    retrieveSubMock.mockResolvedValue(activeSub({ metadata: {} }));
    constructEventMock.mockReturnValue({
      id: "evt_6",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_3",
          client_reference_id: "user_1",
          subscription: "sub_1",
          customer: "cus_1",
          metadata: {},
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(updateClerkMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({ summittSubscribed: true })
    );
    expect(syncSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ summittSubscribed: true })
    );
  });

  it("duplicate event id → acknowledged without handler re-run", async () => {
    insertMock.mockResolvedValue({
      error: { code: "23505", message: "duplicate" },
    });
    constructEventMock.mockReturnValue({
      id: "evt_dup",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const { POST } = await import("./route");
    const res = await POST(webhookReq() as never);
    expect(res.status).toBe(200);
    expect(evaluateUnlockMock).not.toHaveBeenCalled();
    expect(updateClerkMock).not.toHaveBeenCalled();
  });
});

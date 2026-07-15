import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutBlockErrorForClass,
  classifySummittMembership,
  isCheckoutBlockedMembershipClass,
} from "@/lib/summitt-subscription-membership";

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
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

vi.mock("@/lib/coach-attribution", () => ({
  maySetCoachAcquisitionSource: () => false,
}));

const retrieveMock = vi.fn();
const listSubsMock = vi.fn();
const listCustomersMock = vi.fn();
const createSessionMock = vi.fn();
const updateCustomerMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      list: (...args: unknown[]) => listSubsMock(...args),
    };
    customers = {
      list: (...args: unknown[]) => listCustomersMock(...args),
      update: (...args: unknown[]) => updateCustomerMock(...args),
    };
    checkout = {
      sessions: {
        create: (...args: unknown[]) => createSessionMock(...args),
      },
    };
  }
  return { default: StripeMock };
});

function makeSub(partial: Record<string, unknown>) {
  return {
    id: "sub_1",
    status: "active",
    pause_collection: null,
    customer: "cus_1",
    metadata: { userId: "user_1", plan: "monthly" },
    items: {
      data: [
        {
          current_period_end: 2_000_000_000,
          price: {
            id: "price_m",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...partial,
  };
}

describe("checkout membership classification (Path A/B contract)", () => {
  it("paused → checkout block membership_paused", () => {
    const cls = classifySummittMembership(
      makeSub({
        pause_collection: { behavior: "mark_uncollectible" },
      })
    );
    expect(cls).toBe("paused_recoverable");
    expect(isCheckoutBlockedMembershipClass(cls)).toBe(true);
    expect(checkoutBlockErrorForClass(cls)?.error).toBe("membership_paused");
  });

  it("active/trialing/past_due → already_subscribed", () => {
    for (const status of ["active", "trialing", "past_due"] as const) {
      const cls = classifySummittMembership(makeSub({ status }));
      expect(isCheckoutBlockedMembershipClass(cls)).toBe(true);
      expect(checkoutBlockErrorForClass(cls)?.error).toBe("already_subscribed");
    }
  });

  it("canceled ended → not blocked", () => {
    const cls = classifySummittMembership(makeSub({ status: "canceled" }));
    expect(cls).toBe("ended");
    expect(isCheckoutBlockedMembershipClass(cls)).toBe(false);
    expect(checkoutBlockErrorForClass(cls)).toBeNull();
  });

  it("incomplete/unpaid remain other_non_blocking", () => {
    expect(classifySummittMembership(makeSub({ status: "incomplete" }))).toBe(
      "other_non_blocking"
    );
    expect(classifySummittMembership(makeSub({ status: "unpaid" }))).toBe(
      "other_non_blocking"
    );
  });
});

describe("POST /api/stripe/create-checkout-session duplicate protection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout";
    process.env.STRIPE_PRICE_ID_MONTHLY = "price_1TtRauHP6uKt4BBoupJRggJ2";
    process.env.STRIPE_PRICE_ID_ANNUAL = "price_1TtRdEHP6uKt4BBo0Ex8Xw8a";
    process.env.STRIPE_LEGACY_PRICE_IDS =
      "price_1SzRiNHP6uKt4BBok7FrpmQY,price_1SZY92HP6uKt4BBo9gP2ZMXb";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "a@example.com" }],
    });
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      summittSubscribed: false,
      summittPlan: "paused",
    });
    listCustomersMock.mockResolvedValue({ data: [] });
    listSubsMock.mockResolvedValue({ data: [] });
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
    updateCustomerMock.mockResolvedValue({});
    createSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.test/session",
      customer: "cus_1",
    });
  });

  it("Path A: paused subscription → membership_paused", async () => {
    retrieveMock.mockResolvedValue(
      makeSub({
        pause_collection: { behavior: "mark_uncollectible" },
      })
    );
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "membership_paused",
      action: "resume",
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("Path A: active → already_subscribed", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      summittSubscribed: true,
      summittPlan: "monthly",
    });
    retrieveMock.mockResolvedValue(makeSub({ status: "active" }));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_subscribed" });
  });

  it("Path A: trialing → already_subscribed", async () => {
    retrieveMock.mockResolvedValue(makeSub({ status: "trialing" }));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_subscribed");
  });

  it("Path A: past_due → already_subscribed", async () => {
    retrieveMock.mockResolvedValue(makeSub({ status: "past_due" }));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_subscribed");
  });

  it("Path B: paused found via customer scan → membership_paused", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      // no stripeSubscriptionId → skip Path A retrieve block
      summittSubscribed: false,
      summittPlan: "paused",
    });
    listSubsMock.mockResolvedValue({
      data: [
        makeSub({
          pause_collection: { behavior: "mark_uncollectible" },
        }),
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "membership_paused",
      action: "resume",
    });
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        summittPlan: "paused",
        summittSubscribed: false,
      })
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("canceled subscription allows Checkout session creation", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_old",
      summittSubscribed: false,
      summittPlan: null,
    });
    retrieveMock.mockResolvedValue(makeSub({ status: "canceled" }));
    listSubsMock.mockResolvedValue({ data: [] });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/session",
    });
    expect(createSessionMock).toHaveBeenCalled();
  });

  it("monthly plan maps to STRIPE_PRICE_ID_MONTHLY only", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({ data: [] });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({
          plan: "monthly",
          priceId: "price_attacker",
          amount: 1,
        }),
      })
    );
    expect(res.status).toBe(200);
    const createArg = createSessionMock.mock.calls[0][0] as {
      line_items: { price: string }[];
    };
    expect(createArg.line_items).toEqual([
      { price: "price_1TtRauHP6uKt4BBoupJRggJ2", quantity: 1 },
    ]);
  });

  it("annual plan maps to STRIPE_PRICE_ID_ANNUAL only", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({ data: [] });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "annual", price: "price_attacker" }),
      })
    );
    expect(res.status).toBe(200);
    const createArg = createSessionMock.mock.calls[0][0] as {
      line_items: { price: string }[];
    };
    expect(createArg.line_items).toEqual([
      { price: "price_1TtRdEHP6uKt4BBo0Ex8Xw8a", quantity: 1 },
    ]);
  });

  it("rejects non monthly/annual plan without creating a session", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "price_1TtRauHP6uKt4BBoupJRggJ2" }),
      })
    );
    expect(res.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("Path B: legacy Price ID (no metadata) still blocks as already_subscribed", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({
      data: [
        makeSub({
          status: "active",
          metadata: {},
          items: {
            data: [
              {
                current_period_end: 2_000_000_000,
                price: {
                  id: "price_1SzRiNHP6uKt4BBok7FrpmQY",
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        }),
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_subscribed");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("Path B: unrelated Price ID without metadata does not block Checkout", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({
      data: [
        makeSub({
          status: "active",
          metadata: {},
          items: {
            data: [
              {
                current_period_end: 2_000_000_000,
                price: {
                  id: "price_unrelated_other_product",
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        }),
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalled();
  });

  it("Path B: metadata.userId recognition remains valid without Price match", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({
      data: [
        makeSub({
          status: "active",
          metadata: { userId: "user_1" },
          items: {
            data: [
              {
                current_period_end: 2_000_000_000,
                price: {
                  id: "price_unrelated_other_product",
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        }),
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_subscribed");
  });
});

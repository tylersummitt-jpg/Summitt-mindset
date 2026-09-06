import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutBlockErrorForClass,
  classifySummittMembership,
  isCheckoutBlockedMembershipClass,
} from "@/lib/summitt-subscription-membership";

vi.mock("server-only", () => ({}));

const appleLookup = vi.hoisted(() => ({
  data: [] as unknown[],
  error: null as { message: string } | null,
}));

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

vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "apple_subscriptions") {
        return {
          select: () => ({
            eq: async () => ({
              data: appleLookup.data,
              error: appleLookup.error,
            }),
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

const retrieveMock = vi.fn();
const listSubsMock = vi.fn();
const listCustomersMock = vi.fn();
const createCustomerMock = vi.fn();
const createSessionMock = vi.fn();
const updateCustomerMock = vi.fn();
const listCheckoutSessionsMock = vi.fn();
const retrieveCheckoutSessionMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveMock(...args),
      list: (...args: unknown[]) => listSubsMock(...args),
    };
    customers = {
      list: (...args: unknown[]) => listCustomersMock(...args),
      update: (...args: unknown[]) => updateCustomerMock(...args),
      create: (...args: unknown[]) => createCustomerMock(...args),
    };
    checkout = {
      sessions: {
        create: (...args: unknown[]) => createSessionMock(...args),
        list: (...args: unknown[]) => listCheckoutSessionsMock(...args),
        retrieve: (...args: unknown[]) => retrieveCheckoutSessionMock(...args),
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
    assertDeletionMock.mockResolvedValue({ ok: true });
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
    listCheckoutSessionsMock.mockResolvedValue({ data: [], has_more: false });
    retrieveCheckoutSessionMock.mockReset();
    appleLookup.data = [];
    appleLookup.error = null;
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
    updateCustomerMock.mockResolvedValue({});
    createCustomerMock.mockResolvedValue({ id: "cus_created" });
    createSessionMock.mockResolvedValue({
      id: "cs_new",
      status: "open",
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

  it("rejects native iOS User-Agent before calling Stripe", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 SummittMindsetiOS",
        },
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "native_app_checkout_unavailable",
    });
    expect(authMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("rejects native Android User-Agent before calling Stripe", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SummittMindsetAndroid",
        },
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "native_app_checkout_unavailable",
    });
    expect(authMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
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
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      })
    );
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      summittSubscribed: false,
      summittPlan: "paused",
    });
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
      line_items: { price: string; quantity: number }[];
      subscription_data: { trial_period_days: number };
      cancel_url: string;
      success_url: string;
      customer?: string;
      customer_email?: string;
    };
    expect(createArg.line_items).toEqual([
      { price: "price_1TtRauHP6uKt4BBoupJRggJ2", quantity: 1 },
    ]);
    expect(createArg.subscription_data.trial_period_days).toBe(7);
    expect(createArg.cancel_url).toBe(
      "http://localhost:3000/subscribe?canceled=1"
    );
    expect(createArg.success_url).toContain("/subscribe/success?session_id=");
    expect(createArg.customer).toBe("cus_1");
    expect(createArg).not.toHaveProperty("customer_email");
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });
  });

  it("consumer monthly Checkout includes $0 due today custom_text", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({ data: [] });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createSessionMock.mock.calls[0][0].custom_text).toEqual({
      submit: {
        message:
          "**$0 due today.** 7 days free, then $29/month. Cancel anytime.",
      },
    });
  });

  it("annual Checkout does not include monthly custom_text", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listSubsMock.mockResolvedValue({ data: [] });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "annual" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createSessionMock.mock.calls[0][0]).not.toHaveProperty(
      "custom_text"
    );
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

  it("B3b: unresolved deletion → 409, no Stripe session create", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account_deletion_in_progress",
      message: "This action is unavailable.",
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(listSubsMock).not.toHaveBeenCalled();
  });

  it("B3b: deletion lookup failure → 500 fail closed, no Stripe", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(500);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("Apple granting membership → 409 already_subscribed, no session reuse or create", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    appleLookup.data = [
      {
        product_id: "com.summittmindset.ios.membership.monthly",
        status: "active",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    ];
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_open",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/old",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
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
    expect(listCheckoutSessionsMock).not.toHaveBeenCalled();
    expect(retrieveCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("Apple lookup error → 500 fail closed, no Stripe session", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    appleLookup.error = { message: "timeout" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(500);
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(listCheckoutSessionsMock).not.toHaveBeenCalled();
    expect(retrieveCheckoutSessionMock).not.toHaveBeenCalled();
    expect(listSubsMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("reuses a compatible open monthly consumer Checkout Session", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_open",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/reuse",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/reuse",
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("annual open session + monthly request → checkout_pending, no create", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_annual",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/annual",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "annual" },
          line_items: {
            data: [{ price: { id: "price_1TtRdEHP6uKt4BBo0Ex8Xw8a" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("coach open session + consumer request → checkout_pending", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_coach",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/coach",
          client_reference_id: "user_1",
          metadata: {
            userId: "user_1",
            plan: "monthly",
            summittAcquisition: "coach",
          },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("consumer open session + coach request → checkout_pending", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_web",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/web",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly", src: "coach" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("expired or completed Checkout Sessions are not reused", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_expired",
          status: "expired",
          mode: "subscription",
          url: null,
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
        {
          id: "cs_complete",
          status: "complete",
          mode: "subscription",
          url: null,
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("coach create uses v2 coach idempotency and coach cancel_url", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly", src: "coach" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createSessionMock.mock.calls[0][0].cancel_url).toBe(
      "http://localhost:3000/subscribe?canceled=1&src=coach"
    );
    expect(createSessionMock.mock.calls[0][0].metadata).toEqual({
      userId: "user_1",
      plan: "monthly",
      summittAcquisition: "coach",
    });
    expect(createSessionMock.mock.calls[0][0]).not.toHaveProperty(
      "custom_text"
    );
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:coach",
    });
  });

  it("dead complete idempotency replay does not create a successor", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    createSessionMock.mockResolvedValueOnce({
      id: "cs_complete",
      status: "complete",
      url: null,
      customer: "cus_1",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_processing");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });
  });

  it("expired idempotency replay fails closed without successor", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    createSessionMock.mockResolvedValue({
      id: "cs_expired",
      status: "expired",
      url: null,
      customer: "cus_1",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_unavailable");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("same monthly web request uses a stable v2 idempotency key", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    const { POST } = await import("./route");
    const req = () =>
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      });
    expect((await POST(req())).status).toBe(200);
    expect((await POST(req())).status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });
    expect(createSessionMock.mock.calls[1][1]).toEqual(
      createSessionMock.mock.calls[0][1]
    );
    expect(createSessionMock.mock.calls[1][0]).toEqual(
      createSessionMock.mock.calls[0][0]
    );
  });

  it("does not expire Checkout Sessions", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const route = readFileSync(
      join(process.cwd(), "src/app/api/stripe/create-checkout-session/route.ts"),
      "utf8"
    );
    expect(route).not.toContain("sessions.expire");
    expect(route).not.toContain("sessions.search");
    expect(route).not.toContain("checkout-subscription-v1:");
    expect(route).not.toContain(":after:");
    expect(route).not.toContain("/checkout/start");
    expect(route).not.toContain("customer_email");
    expect(route).toContain("/subscribe?canceled=1");
  });

  it("no stripeCustomerId creates an idempotent customer then Checkout with that customer", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      summittSubscribed: false,
    });
    createCustomerMock.mockResolvedValue({ id: "cus_from_create" });
    createSessionMock.mockResolvedValue({
      id: "cs_new",
      status: "open",
      url: "https://checkout.stripe.test/session",
      customer: "cus_from_create",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(createCustomerMock.mock.calls[0][0]).toEqual({
      email: "a@example.com",
      metadata: { userId: "user_1" },
    });
    expect(createCustomerMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-customer-v1:user_1",
    });
    expect(listCheckoutSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_from_create", status: "open" })
    );
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const createArg = createSessionMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(createArg.customer).toBe("cus_from_create");
    expect(createArg).not.toHaveProperty("customer_email");
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("user_1", {
      stripeCustomerId: "cus_from_create",
    });
  });

  it("customer id appearing after first create does not change v2 create params", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      summittSubscribed: false,
    });
    createCustomerMock.mockResolvedValue({ id: "cus_from_create" });
    createSessionMock.mockResolvedValue({
      id: "cs_new",
      status: "open",
      url: "https://checkout.stripe.test/session",
      customer: "cus_from_create",
    });
    const { POST } = await import("./route");
    const req = () =>
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      });

    const first = await POST(req());
    expect(first.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const firstParams = createSessionMock.mock.calls[0][0];
    const firstKey = createSessionMock.mock.calls[0][1];
    expect(firstParams.customer).toBe("cus_from_create");
    expect(firstParams).not.toHaveProperty("customer_email");
    expect(firstKey).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });

    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_from_create",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({ data: [], has_more: false });
    createCustomerMock.mockClear();

    const second = await POST(req());
    expect(second.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(createSessionMock.mock.calls[1][0]).toEqual(firstParams);
    expect(createSessionMock.mock.calls[1][1]).toEqual(firstKey);
  });

  it("Stripe idempotency_error does not return a Checkout URL or create a successor", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    createSessionMock.mockRejectedValueOnce({
      type: "StripeIdempotencyError",
      rawType: "idempotency_error",
      message:
        "Keys for idempotent requests can only be used with the same parameters",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("checkout_unavailable");
    expect(body.url).toBeUndefined();
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "checkout-subscription-v2:user_1:monthly:web",
    });
  });

  it("paginates customer-scoped open session list", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `cs_old_${String(i).padStart(3, "0")}`,
      status: "open",
      mode: "payment",
      url: "https://checkout.stripe.test/other",
      client_reference_id: "user_other",
      metadata: {},
      line_items: { data: [] },
    }));
    listCheckoutSessionsMock
      .mockResolvedValueOnce({ data: page1, has_more: true })
      .mockResolvedValueOnce({
        data: [
          {
            id: "cs_open",
            status: "open",
            mode: "subscription",
            url: "https://checkout.stripe.test/reuse",
            client_reference_id: "user_1",
            metadata: { userId: "user_1", plan: "monthly" },
            line_items: {
              data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
            },
          },
        ],
        has_more: false,
      });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/reuse",
    });
    expect(listCheckoutSessionsMock).toHaveBeenCalledTimes(2);
    expect(listCheckoutSessionsMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        customer: "cus_1",
        status: "open",
        starting_after: "cs_old_099",
      })
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("compatible + incompatible owned sessions → checkout_pending", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_monthly",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/monthly",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
        {
          id: "cs_annual",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/annual",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "annual" },
          line_items: {
            data: [{ price: { id: "price_1TtRdEHP6uKt4BBo0Ex8Xw8a" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("disagreeing identity on an open session → checkout_pending", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_conflict",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/conflict",
          client_reference_id: "user_1",
          metadata: { userId: "user_other", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("multiple line items are not reused", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_multi",
          status: "open",
          mode: "subscription",
          url: "https://checkout.stripe.test/multi",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [
              { price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } },
              { price: { id: "price_1TtRdEHP6uKt4BBo0Ex8Xw8a" } },
            ],
          },
        },
      ],
      has_more: false,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("missing URL retrieves the session before reuse", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_open",
          status: "open",
          mode: "subscription",
          url: null,
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    retrieveCheckoutSessionMock.mockResolvedValue({
      id: "cs_open",
      status: "open",
      mode: "subscription",
      url: "https://checkout.stripe.test/retrieved",
      client_reference_id: "user_1",
      metadata: { userId: "user_1", plan: "monthly" },
      line_items: {
        data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://checkout.stripe.test/retrieved",
    });
    expect(retrieveCheckoutSessionMock).toHaveBeenCalledWith("cs_open", {
      expand: ["line_items"],
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("complete idempotency replay with visible membership returns already_subscribed", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    createSessionMock.mockResolvedValue({
      id: "cs_complete",
      status: "complete",
      url: null,
      customer: "cus_1",
    });
    listSubsMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [makeSub({ status: "trialing" })],
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
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("missing URL retrieve without a usable URL fails closed without creating", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({
      stripeCustomerId: "cus_1",
      summittSubscribed: false,
    });
    listCheckoutSessionsMock.mockResolvedValue({
      data: [
        {
          id: "cs_open",
          status: "open",
          mode: "subscription",
          url: null,
          client_reference_id: "user_1",
          metadata: { userId: "user_1", plan: "monthly" },
          line_items: {
            data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
          },
        },
      ],
      has_more: false,
    });
    retrieveCheckoutSessionMock.mockResolvedValue({
      id: "cs_open",
      status: "open",
      mode: "subscription",
      url: null,
      client_reference_id: "user_1",
      metadata: { userId: "user_1", plan: "monthly" },
      line_items: {
        data: [{ price: { id: "price_1TtRauHP6uKt4BBoupJRggJ2" } }],
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/stripe/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("checkout_pending");
    expect(retrieveCheckoutSessionMock).toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

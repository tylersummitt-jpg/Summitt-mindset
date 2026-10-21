import { beforeEach, describe, expect, it, vi } from "vitest";

const { startTrialMock, googleTrialMock } = vi.hoisted(() => ({
  startTrialMock: vi.fn(),
  googleTrialMock: vi.fn(async () => undefined),
}));

const loadIntentMock = vi.fn();
const confirmMock = vi.fn();
const holdMock = vi.fn();
const sendMock = vi.fn();
const retrieveSubMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  loadIntentById: (...args: unknown[]) => loadIntentMock(...args),
  confirmStripeTrial: (...args: unknown[]) => confirmMock(...args),
}));

vi.mock("@/lib/stripe-first-checkout/stripe-hold", () => ({
  reconcileActivationHold: (...args: unknown[]) => holdMock(...args),
}));

vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
    };
  }
  return { default: StripeMock };
});

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (...args: unknown[]) => sendMock(...args),
    };
  },
}));

vi.mock("@/lib/google-ads/stripe-conversions", () => ({
  maybeEmitGoogleAdsTrial: (...args: unknown[]) => googleTrialMock(...args),
}));

vi.mock("@/lib/meta-capi-stripe-conversions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta-capi-stripe-conversions")>(
    "@/lib/meta-capi-stripe-conversions"
  );
  return {
    ...actual,
    maybeEmitMetaStartTrialFromCheckout: (...args: unknown[]) => startTrialMock(...args),
  };
});

import { metaStartTrialEventId } from "@/lib/meta-capi-stripe-conversions";
import { reconcileStripeFirstFromCheckoutSession } from "@/lib/stripe-first-checkout/reconcile";

const MONTHLY = "price_monthly";
const ANNUAL = "price_annual";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent_1",
    livemode: false,
    stripe_checkout_session_id: "cs_1",
    clerk_user_id: null,
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "trialing",
    trial_end: 1_800_000_000,
    pause_collection: null,
    livemode: false,
    metadata: { plan: "monthly" },
    items: {
      data: [{ price: { id: MONTHLY, recurring: { interval: "month" } } }],
    },
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    status: "complete",
    payment_status: "no_payment_required",
    mode: "subscription",
    livemode: false,
    created: 1_700_000_000,
    subscription: "sub_1",
    customer: "cus_1",
    customer_details: {
      email: "pat@example.com",
      name: "Pat Summitt",
      phone: null,
    },
    customer_email: null,
    metadata: { checkoutIntentId: "intent_1" },
    ...overrides,
  };
}

describe("Stripe-first Meta StartTrial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_start_trial";
    process.env.STRIPE_PRICE_ID_MONTHLY = MONTHLY;
    process.env.STRIPE_PRICE_ID_ANNUAL = ANNUAL;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.COACH_KIT_NOTIFY_EMAIL = "tyler@summittmindset.com";
    delete process.env.COACH_KIT_NOTIFY_FROM;
    loadIntentMock.mockResolvedValue(intent());
    confirmMock.mockResolvedValue("saved");
    holdMock.mockResolvedValue("ok");
    retrieveSubMock.mockResolvedValue(subscription());
    sendMock.mockResolvedValue({ data: { id: "re_1" }, error: null });
    startTrialMock.mockResolvedValue(undefined);
    googleTrialMock.mockResolvedValue(undefined);
  });

  it("invokes StartTrial for a verified monthly Stripe-first trial without a Clerk user", async () => {
    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(outcome).toBe("ack");
    expect(startTrialMock).toHaveBeenCalledTimes(1);
    expect(googleTrialMock).toHaveBeenCalledTimes(1);
    expect(googleTrialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ id: "intent_1" }),
        subscription: expect.objectContaining({ id: "sub_1", status: "trialing" }),
      })
    );
    expect(startTrialMock).toHaveBeenCalledWith({
      subscription: expect.objectContaining({ id: "sub_1", status: "trialing" }),
      userId: null,
      eventCreatedUnix: 1_700_000_000,
      eventSourceUrl: "https://summittmindset.com/checkout/start",
      webMatch: {
        fbc: null,
        fbp: null,
        clientIpAddress: null,
        clientUserAgent: null,
      },
    });
    expect(metaStartTrialEventId("sub_1")).toBe("start_trial:sub_1");
    const passedUserId = startTrialMock.mock.calls[0]?.[0]?.userId;
    expect(passedUserId).toBeNull();
    expect(passedUserId).not.toBe("not created yet");
  });

  it("passes checkout match fields and Stripe trial_start for a monthly trial", async () => {
    loadIntentMock.mockResolvedValue(
      intent({
        meta_fbc: "fb.1.1700000000000.AbCdEf",
        meta_fbp: "fb.1.1700000000000.1234567890",
        client_ip: "8.8.8.8",
        client_user_agent: "Mozilla/5.0 TestBrowser",
      })
    );
    retrieveSubMock.mockResolvedValue(
      subscription({ trial_start: 1_700_000_100, created: 1_700_000_050 })
    );

    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(outcome).toBe("ack");
    expect(startTrialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        eventCreatedUnix: 1_700_000_100,
        eventSourceUrl: "https://summittmindset.com/checkout/start",
        webMatch: {
          fbc: "fb.1.1700000000000.AbCdEf",
          fbp: "fb.1.1700000000000.1234567890",
          clientIpAddress: "8.8.8.8",
          clientUserAgent: "Mozilla/5.0 TestBrowser",
        },
      })
    );
  });

  it("invokes StartTrial for a verified annual Stripe-first trial", async () => {
    retrieveSubMock.mockResolvedValue(
      subscription({
        id: "sub_annual",
        trial_start: 1_700_000_200,
        metadata: { plan: "annual" },
        items: {
          data: [{ price: { id: ANNUAL, recurring: { interval: "year" } } }],
        },
      })
    );

    const outcome = await reconcileStripeFirstFromCheckoutSession(
      session({ subscription: "sub_annual" }) as never
    );

    expect(outcome).toBe("ack");
    expect(startTrialMock).toHaveBeenCalledTimes(1);
    expect(startTrialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ id: "sub_annual" }),
        userId: null,
        eventCreatedUnix: 1_700_000_200,
        eventSourceUrl: "https://summittmindset.com/checkout/start",
      })
    );
    expect(metaStartTrialEventId("sub_annual")).toBe("start_trial:sub_annual");
  });

  it("does not invoke StartTrial when checkout is opened but not completed", async () => {
    loadIntentMock.mockResolvedValue(intent({ stripe_checkout_session_id: "cs_open" }));

    const outcome = await reconcileStripeFirstFromCheckoutSession(
      session({
        id: "cs_open",
        status: "open",
        payment_status: "unpaid",
        subscription: null,
        customer: null,
      }) as never
    );

    expect(outcome).toBe("ack");
    expect(confirmMock).not.toHaveBeenCalled();
    expect(startTrialMock).not.toHaveBeenCalled();
    expect(googleTrialMock).not.toHaveBeenCalled();
  });

  it("does not invoke StartTrial for an ineligible subscription", async () => {
    retrieveSubMock.mockResolvedValue(
      subscription({ status: "canceled", trial_end: null })
    );
    const canceled = await reconcileStripeFirstFromCheckoutSession(session() as never);

    retrieveSubMock.mockResolvedValue(
      subscription({
        items: { data: [{ price: { id: "price_unrecognized" } }] },
      })
    );
    const unrecognized = await reconcileStripeFirstFromCheckoutSession(session() as never);

    retrieveSubMock.mockResolvedValue(
      subscription({ pause_collection: { behavior: "mark_uncollectible" } })
    );
    const paused = await reconcileStripeFirstFromCheckoutSession(session() as never);

    confirmMock.mockResolvedValue("mismatch");
    retrieveSubMock.mockResolvedValue(subscription());
    const mismatch = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(canceled).toBe("ack");
    expect(unrecognized).toBe("ack");
    expect(paused).toBe("ack");
    expect(mismatch).toBe("ack");
    expect(startTrialMock).not.toHaveBeenCalled();
    expect(googleTrialMock).not.toHaveBeenCalled();
  });

  it("does not invoke StartTrial for an owner canary", async () => {
    retrieveSubMock.mockResolvedValue(
      subscription({ metadata: { summittCanary: "owner", plan: "monthly" } })
    );

    const outcome = await reconcileStripeFirstFromCheckoutSession(
      session({
        metadata: { checkoutIntentId: "intent_1", summittCanary: "owner" },
      }) as never
    );

    expect(outcome).toBe("ack");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(startTrialMock).not.toHaveBeenCalled();
    expect(googleTrialMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("repeats the same subscription identity when reconciliation runs again", async () => {
    confirmMock.mockResolvedValueOnce("saved").mockResolvedValueOnce("already");

    const first = await reconcileStripeFirstFromCheckoutSession(session() as never);
    const second = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(first).toBe("ack");
    expect(second).toBe("ack");
    expect(startTrialMock).toHaveBeenCalledTimes(2);
    const firstCall = startTrialMock.mock.calls[0]?.[0];
    const secondCall = startTrialMock.mock.calls[1]?.[0];
    expect(firstCall.subscription.id).toBe("sub_1");
    expect(secondCall.subscription.id).toBe(firstCall.subscription.id);
    expect(firstCall.userId).toBeNull();
    expect(secondCall.userId).toBeNull();
    expect(metaStartTrialEventId(firstCall.subscription.id)).toBe(
      metaStartTrialEventId(secondCall.subscription.id)
    );
    expect(metaStartTrialEventId(firstCall.subscription.id)).toBe("start_trial:sub_1");
  });

  it("passes an existing Clerk user id through and does not invent one", async () => {
    loadIntentMock.mockResolvedValue(intent({ clerk_user_id: "user_already_linked" }));

    await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(startTrialMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_already_linked" })
    );
  });

  it("keeps checkout successful when Meta delivery throws", async () => {
    startTrialMock.mockRejectedValue(new Error("meta down"));

    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(outcome).toBe("ack");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(holdMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(startTrialMock).toHaveBeenCalledTimes(1);
    expect(googleTrialMock).toHaveBeenCalledTimes(1);
  });

  it("keeps checkout successful when Google delivery throws", async () => {
    googleTrialMock.mockRejectedValue(new Error("google down"));

    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(outcome).toBe("ack");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

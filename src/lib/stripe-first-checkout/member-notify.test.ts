import { beforeEach, describe, expect, it, vi } from "vitest";

const loadIntentMock = vi.fn();
const confirmMock = vi.fn();
const holdMock = vi.fn();
const sendMock = vi.fn();
const retrieveSubMock = vi.fn();

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

import { notifyMemberSubscribedInternal } from "@/lib/notify-member-subscribed";
import {
  notifyConfirmedStripeFirstTrial,
  stripeFirstMemberNotification,
  stripeFirstMemberNotifyKey,
  type StripeFirstMemberNotice,
} from "@/lib/stripe-first-checkout/member-notify";
import { reconcileStripeFirstFromCheckoutSession } from "@/lib/stripe-first-checkout/reconcile";

const PRICE = "price_monthly";

function notice(overrides: Partial<StripeFirstMemberNotice> = {}): StripeFirstMemberNotice {
  return {
    ownerCanary: false,
    subscriptionStatus: "trialing",
    paused: false,
    clerkUserId: "user_clerk",
    email: "pat@example.com",
    name: "Pat Summitt",
    phone: null,
    customerId: "cus_1",
    subscriptionId: "sub_1",
    checkoutSessionId: "cs_1",
    plan: "monthly",
    timestamp: "2026-10-16T12:00:00.000Z",
    ...overrides,
  };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent_1",
    livemode: false,
    stripe_checkout_session_id: "cs_1",
    clerk_user_id: "user_clerk",
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
      data: [{ price: { id: PRICE, recurring: { interval: "month" } } }],
    },
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    livemode: false,
    subscription: "sub_1",
    customer: "cus_1",
    customer_details: {
      email: "Pat@Example.com",
      name: "Pat Summitt",
      phone: null,
    },
    customer_email: null,
    metadata: { checkoutIntentId: "intent_1" },
    ...overrides,
  };
}

describe("stripe-first member notification decision", () => {
  it("sends the existing new-member email for a confirmed trial", () => {
    const decision = stripeFirstMemberNotification(notice());
    expect(decision.send).toBe(true);
    if (!decision.send) return;
    expect(decision.idempotencyKey).toBe(stripeFirstMemberNotifyKey("sub_1"));
    expect(decision.payload).toMatchObject({
      memberName: "Pat Summitt",
      memberEmail: "pat@example.com",
      memberPhone: "not provided",
      clerkUserId: "user_clerk",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "trialing",
      checkoutSessionId: "cs_1",
      plan: "monthly",
    });
  });

  it("includes a placeholder when the Clerk user does not exist yet", () => {
    const decision = stripeFirstMemberNotification(notice({ clerkUserId: null }));
    expect(decision.send).toBe(true);
    if (!decision.send) return;
    expect(decision.payload.clerkUserId).toBe("not created yet");
  });

  it("sends for an active entitled subscription and not for an unfinished one", () => {
    expect(stripeFirstMemberNotification(notice({ subscriptionStatus: "active" })).send).toBe(
      true
    );
    expect(stripeFirstMemberNotification(notice({ subscriptionStatus: "incomplete" })).send).toBe(
      false
    );
    expect(stripeFirstMemberNotification(notice({ subscriptionStatus: "canceled" })).send).toBe(
      false
    );
    expect(stripeFirstMemberNotification(notice({ paused: true })).send).toBe(false);
  });

  it("excludes the owner canary", () => {
    expect(
      stripeFirstMemberNotification(
        notice({ ownerCanary: true, subscriptionStatus: "canceled" })
      ).send
    ).toBe(false);
    expect(
      stripeFirstMemberNotification(
        notice({ ownerCanary: true, subscriptionStatus: "trialing" })
      ).send
    ).toBe(false);
  });

  it("uses one idempotency key for webhook and browser processing", () => {
    const first = stripeFirstMemberNotification(notice());
    const second = stripeFirstMemberNotification(
      notice({ clerkUserId: "user_later", timestamp: "2026-10-16T12:05:00.000Z" })
    );
    expect(first.send && second.send).toBe(true);
    if (!first.send || !second.send) return;
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toBe("stripe-first-member-sub_1");
  });
});

describe("existing member notification email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "re_1" }, error: null });
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.COACH_KIT_NOTIFY_EMAIL = "tyler@summittmindset.com";
    delete process.env.COACH_KIT_NOTIFY_FROM;
  });

  it("keeps the challenge sender, Tyler inbox, and subject", async () => {
    const outcome = await notifyMemberSubscribedInternal({
      memberName: "Pat Summitt",
      memberEmail: "pat@example.com",
      memberPhone: "not provided",
      clerkUserId: "user_1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "trialing",
      checkoutSessionId: "cs_1",
      plan: "monthly",
      timestamp: "2026-10-16T12:00:00.000Z",
    });
    expect(outcome).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "challenge@summittmindset.com",
      to: "tyler@summittmindset.com",
      subject: "Reach out to new member — Pat Summitt",
    });
    expect(sendMock.mock.calls[0][0].text).toContain("New Summitt Mindset member signed up.");
    expect(sendMock.mock.calls[0][0].text).toContain("Reach out to new member.");
    expect(sendMock.mock.calls[0][1]).toBeUndefined();
  });

  it("reports a Resend failure without throwing", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    await expect(
      notifyMemberSubscribedInternal({
        memberName: "not provided",
        memberEmail: "pat@example.com",
        memberPhone: "not provided",
        clerkUserId: "user_1",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: "trialing",
        checkoutSessionId: "cs_1",
        plan: "monthly",
        timestamp: "2026-10-16T12:00:00.000Z",
      })
    ).resolves.toBe("failed");
  });
});

describe("reconcileStripeFirstFromCheckoutSession member email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_notify";
    process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.COACH_KIT_NOTIFY_EMAIL = "tyler@summittmindset.com";
    delete process.env.COACH_KIT_NOTIFY_FROM;
    loadIntentMock.mockResolvedValue(intent());
    confirmMock.mockResolvedValue("saved");
    holdMock.mockResolvedValue("ok");
    retrieveSubMock.mockResolvedValue(subscription());
    sendMock.mockResolvedValue({ data: { id: "re_1" }, error: null });
  });

  it("sends one existing email when a new Stripe-first trial is confirmed", async () => {
    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);
    expect(outcome).toBe("ack");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      from: "challenge@summittmindset.com",
      to: "tyler@summittmindset.com",
      subject: "Reach out to new member — Pat Summitt",
    });
    expect(sendMock.mock.calls[0][0].text).toContain("Email: pat@example.com");
    expect(sendMock.mock.calls[0][0].text).toContain("Clerk user ID: user_clerk");
    expect(sendMock.mock.calls[0][0].text).toContain("Stripe customer ID: cus_1");
    expect(sendMock.mock.calls[0][0].text).toContain("Stripe subscription ID: sub_1");
    expect(sendMock.mock.calls[0][0].text).toContain("Subscription status: trialing");
    expect(sendMock.mock.calls[0][0].text).toContain("Checkout session ID: cs_1");
    expect(sendMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "stripe-first-member-sub_1",
    });
  });

  it("does not send when checkout is opened but not completed", async () => {
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
    expect(retrieveSubMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reuses one Resend idempotency key when webhook and browser both confirm", async () => {
    confirmMock.mockResolvedValueOnce("saved").mockResolvedValueOnce("already");
    const browser = notifyConfirmedStripeFirstTrial(notice());
    const webhook = reconcileStripeFirstFromCheckoutSession(session() as never);
    const [browserOutcome, webhookOutcome] = await Promise.all([browser, webhook]);
    expect(browserOutcome).toBe("sent");
    expect(webhookOutcome).toBe("ack");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][1].idempotencyKey).toBe("stripe-first-member-sub_1");
    expect(sendMock.mock.calls[1][1].idempotencyKey).toBe("stripe-first-member-sub_1");
  });

  it("asks Stripe to retry when Resend fails and does not skip the hold", async () => {
    const order: string[] = [];
    holdMock.mockImplementation(async () => {
      order.push("hold");
      return "ok";
    });
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    sendMock.mockResolvedValueOnce({ data: { id: "re_retry" }, error: null });
    confirmMock.mockResolvedValueOnce("saved").mockResolvedValueOnce("already");

    const first = await reconcileStripeFirstFromCheckoutSession(session() as never);
    const second = await reconcileStripeFirstFromCheckoutSession(session() as never);

    expect(first).toBe("retry");
    expect(second).toBe("ack");
    expect(order[0]).toBe("hold");
    expect(sendMock.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
      "stripe-first-member-sub_1",
      "stripe-first-member-sub_1",
    ]);
  });

  it("does not retry the webhook when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const outcome = await reconcileStripeFirstFromCheckoutSession(session() as never);
    expect(outcome).toBe("ack");
    expect(holdMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not email the canceled owner canary", async () => {
    retrieveSubMock.mockResolvedValue(
      subscription({
        status: "canceled",
        trial_end: null,
        metadata: { summittCanary: "owner", plan: "monthly" },
      })
    );
    const outcome = await reconcileStripeFirstFromCheckoutSession(
      session({ metadata: { checkoutIntentId: "intent_1", summittCanary: "owner" } }) as never
    );
    expect(outcome).toBe("ack");
    expect(confirmMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not email an owner canary that is still trialing", async () => {
    retrieveSubMock.mockResolvedValue(
      subscription({ metadata: { summittCanary: "owner", plan: "monthly" } })
    );
    const outcome = await reconcileStripeFirstFromCheckoutSession(
      session({ metadata: { checkoutIntentId: "intent_1", summittCanary: "owner" } }) as never
    );
    expect(outcome).toBe("ack");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

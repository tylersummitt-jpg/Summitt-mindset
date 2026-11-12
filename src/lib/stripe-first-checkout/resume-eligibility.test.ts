import { describe, expect, it } from "vitest";
import {
  decideResumeStripe,
  type ResumeIntentSnapshot,
  type ResumeStripeSnapshot,
} from "@/lib/stripe-first-checkout/resume-eligibility";

const NOW = 1_763_000_000;
const TRIAL_END = 1_800_000_000;

function intent(overrides: Partial<ResumeIntentSnapshot> = {}): ResumeIntentSnapshot {
  return {
    id: "intent_1",
    livemode: false,
    email: "member@example.com",
    customerId: "cus_1",
    subscriptionId: "sub_1",
    holdCancelAt: new Date(TRIAL_END * 1000).toISOString(),
    trialEndAt: new Date(TRIAL_END * 1000).toISOString(),
    sessionStarted: false,
    claimedByThisUser: false,
    ...overrides,
  };
}

function stripe(overrides: Partial<ResumeStripeSnapshot> = {}): ResumeStripeSnapshot {
  return {
    subscriptionId: "sub_1",
    customerId: "cus_1",
    livemode: false,
    status: "trialing",
    paused: false,
    cancelAt: TRIAL_END,
    cancelAtPeriodEnd: false,
    trialEnd: TRIAL_END,
    priceRecognized: true,
    checkoutIntentId: "intent_1",
    subscriptionUserId: null,
    canary: false,
    stripeFirst: true,
    customerDeleted: false,
    customerEmail: "member@example.com",
    customerUserId: null,
    ...overrides,
  };
}

function decide(
  intentOverrides: Partial<ResumeIntentSnapshot> = {},
  stripeOverrides: Partial<ResumeStripeSnapshot> = {}
) {
  return decideResumeStripe({
    intent: intent(intentOverrides),
    stripe: stripe(stripeOverrides),
    clerkUserId: "user_1",
    nowUnix: NOW,
  });
}

describe("decideResumeStripe", () => {
  it("allows a confirmed Stripe-first trial on our activation hold", () => {
    expect(decide().outcome).toBe("ready");
  });

  it("allows monthly, annual, and partner prices when the price is recognized", () => {
    expect(decide({}, { priceRecognized: true }).outcome).toBe("ready");
  });

  it("allows an active converted subscription on the original hold", () => {
    expect(
      decide({}, { status: "active", trialEnd: NOW - 10, cancelAt: TRIAL_END }).outcome
    ).toBe("ready");
  });

  it("allows a cleared hold only after this user already claimed the intent", () => {
    expect(decide({}, { cancelAt: null }).outcome).toBe("conflict");
    expect(
      decide(
        { sessionStarted: true, claimedByThisUser: true },
        { cancelAt: null, subscriptionUserId: "user_1" }
      ).outcome
    ).toBe("ready");
  });

  it("preserves a customer cancellation and a foreign hold", () => {
    expect(decide({}, { cancelAtPeriodEnd: true, cancelAt: null }).outcome).toBe("preserved");
    expect(decide({}, { status: "canceled" }).outcome).toBe("preserved");
    expect(decide({}, { cancelAt: TRIAL_END + 86_400 }).outcome).toBe("preserved");
  });

  it("refuses an expired trial, paused subscription, or unrecognized price", () => {
    expect(decide({}, { trialEnd: NOW - 1 }).outcome).toBe("conflict");
    expect(decide({}, { paused: true }).outcome).toBe("conflict");
    expect(decide({}, { priceRecognized: false }).outcome).toBe("conflict");
  });

  it("refuses a customer, subscription, intent, or owner mismatch", () => {
    expect(decide({}, { customerId: "cus_other" }).outcome).toBe("conflict");
    expect(decide({}, { customerEmail: "other@example.com" }).outcome).toBe("conflict");
    expect(decide({}, { customerDeleted: true, customerEmail: null }).outcome).toBe("conflict");
    expect(decide({}, { checkoutIntentId: "intent_other" }).outcome).toBe("conflict");
    expect(decide({}, { subscriptionUserId: "user_other" }).outcome).toBe("conflict");
    expect(decide({}, { customerUserId: "user_other" }).outcome).toBe("conflict");
    expect(decide({}, { stripeFirst: false }).outcome).toBe("conflict");
    expect(decide({}, { canary: true }).outcome).toBe("conflict");
  });
});

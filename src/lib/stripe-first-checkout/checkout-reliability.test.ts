import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  STRANDED_NEW_CUSTOMER_GRACE_MS,
  bindingMaxAgeSeconds,
  duplicateTrialBlockFromSubscription,
  duplicateTrialNextPath,
  entitlementFromStoredSubscription,
  isStrandedNewCustomerIntent,
  priorCheckoutAction,
  publicCheckoutFinishUrl,
} from "@/lib/stripe-first-checkout/checkout-reliability";
import { BINDING_MAX_AGE_SECONDS } from "@/lib/stripe-first-checkout/constants";

const NOW = Date.parse("2026-10-13T18:00:00.000Z");
const TRIAL_END = new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString();
const CONFIRMED = new Date(NOW - STRANDED_NEW_CUSTOMER_GRACE_MS - 60_000).toISOString();

describe("duplicate trials for an existing membership", () => {
  it("blocks active, trialing, paused, and past-due subscriptions", () => {
    expect(duplicateTrialBlockFromSubscription({ status: "active" })).toBe("stripe");
    expect(duplicateTrialBlockFromSubscription({ status: "trialing" })).toBe("stripe");
    expect(
      duplicateTrialBlockFromSubscription({
        status: "active",
        pause_collection: { behavior: "void" },
      })
    ).toBe("paused");
    expect(duplicateTrialBlockFromSubscription({ status: "past_due" })).toBe("past_due");
  });

  it("does not block a canceled subscription or a subscription Stripe no longer has", () => {
    expect(duplicateTrialBlockFromSubscription({ status: "canceled" })).toBeNull();
    expect(entitlementFromStoredSubscription({ kind: "missing" })).toBeNull();
  });

  it("does not treat a failed or mismatched lookup as proof the membership is gone", () => {
    expect(entitlementFromStoredSubscription({ kind: "unavailable" })).toBe("retry");
  });

  it("sends a paused member to resume and everyone else already protected to post-sign-in", () => {
    expect(duplicateTrialNextPath("paused")).toBe("/subscribe");
    expect(duplicateTrialNextPath("past_due")).toBe("/post-sign-in");
    expect(duplicateTrialNextPath("stripe")).toBe("/post-sign-in");
    expect(duplicateTrialNextPath("apple")).toBe("/post-sign-in");
  });

  it("cancels only the new trial after authentication", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const link = activate.slice(activate.indexOf("export async function linkExistingHostedCheckout"));
    expect(link).toContain("cancelUnlinkedTrial(intent.stripe_subscription_id)");
    expect(link).not.toContain('return "mismatch"');
    expect(link).toContain('entitlement === "retry"');
    expect(link).toContain("duplicateTrialNextPath");
  });
});

describe("activation hold release survives a failed first attempt", () => {
  it("reconciles the hold before a started session is treated as finished", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const branch = activate.slice(
      activate.indexOf("if (intent.session_started_at && intent.clerk_user_provisioned_at)"),
      activate.indexOf("if (intent.sign_in_required_at && !intent.session_started_at)")
    );
    expect(branch.indexOf("finishActivationHold")).toBeGreaterThan(-1);
    expect(branch.indexOf("finishActivationHold")).toBeLessThan(branch.indexOf('status: "continue"'));
    expect(branch).toContain('status: "retry"');
    expect(branch).toContain('status: "preserved"');
    expect(activate).toContain("async function finishActivationHold");
  });
});

describe("older checkout tabs and binding lifetime", () => {
  it("reuses an open session of the same plan instead of rotating the binding", () => {
    expect(
      priorCheckoutAction({ status: "open", samePlan: true, hasUrl: true })
    ).toBe("reuse");
  });

  it("keeps the binding when expiration fails or the session is still open", () => {
    expect(
      priorCheckoutAction({
        status: "open",
        samePlan: false,
        hasUrl: true,
        expireResult: "failed",
      })
    ).toBe("keep");
    expect(
      priorCheckoutAction({
        status: "open",
        samePlan: false,
        hasUrl: true,
        expireResult: "open",
      })
    ).toBe("keep");
  });

  it("does not replace a session whose payment completed during expiration", () => {
    expect(
      priorCheckoutAction({
        status: "open",
        samePlan: false,
        hasUrl: true,
        expireResult: "complete",
      })
    ).toBe("finish");
  });

  it("replaces only a session that Stripe confirms is expired", () => {
    expect(
      priorCheckoutAction({
        status: "open",
        samePlan: false,
        hasUrl: true,
        expireResult: "expired",
      })
    ).toBe("replace");
    expect(priorCheckoutAction({ status: "expired", samePlan: true, hasUrl: false })).toBe(
      "replace"
    );
  });

  it("finishes a completed session without putting the binding secret in the URL", () => {
    expect(priorCheckoutAction({ status: "complete", samePlan: false, hasUrl: false })).toBe(
      "finish"
    );
    const url = publicCheckoutFinishUrl("https://summittmindset.com", "cs_live_123");
    expect(url).toBe("https://summittmindset.com/checkout/return?session_id=cs_live_123");
    expect(url).not.toContain("sm_checkout_bind");
  });

  it("sizes the binding to the Checkout Session expiry, with a 24-hour fallback", () => {
    expect(BINDING_MAX_AGE_SECONDS).toBe(60 * 60 * 24);
    expect(bindingMaxAgeSeconds(null, NOW)).toBe(BINDING_MAX_AGE_SECONDS);
    expect(bindingMaxAgeSeconds(Math.floor(NOW / 1000) + 5000, NOW)).toBe(5000);
  });
});

describe("paid trials with no account", () => {
  it("alerts a new customer who never returned, after the grace and before trial end", () => {
    expect(
      isStrandedNewCustomerIntent({
        trialConfirmedAt: CONFIRMED,
        provisionedAt: null,
        signInRequiredAt: null,
        sessionStartedAt: null,
        trialEndAt: TRIAL_END,
        nowMs: NOW,
      })
    ).toBe(true);
  });

  it("does not treat a waiting email-code sign-in as a stranded new customer", () => {
    expect(
      isStrandedNewCustomerIntent({
        trialConfirmedAt: CONFIRMED,
        provisionedAt: null,
        signInRequiredAt: CONFIRMED,
        sessionStartedAt: null,
        trialEndAt: TRIAL_END,
        nowMs: NOW,
      })
    ).toBe(false);
  });

  it("does not alert during the return grace or after the account exists", () => {
    expect(
      isStrandedNewCustomerIntent({
        trialConfirmedAt: new Date(NOW - 60_000).toISOString(),
        provisionedAt: null,
        signInRequiredAt: null,
        sessionStartedAt: null,
        trialEndAt: TRIAL_END,
        nowMs: NOW,
      })
    ).toBe(false);
    expect(
      isStrandedNewCustomerIntent({
        trialConfirmedAt: CONFIRMED,
        provisionedAt: CONFIRMED,
        signInRequiredAt: null,
        sessionStartedAt: null,
        trialEndAt: TRIAL_END,
        nowMs: NOW,
      })
    ).toBe(false);
  });
});

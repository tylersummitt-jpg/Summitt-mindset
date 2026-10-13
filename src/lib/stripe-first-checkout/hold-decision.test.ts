import { describe, expect, it } from "vitest";

import { decideHold, type HoldIntentView, type HoldSubscriptionView } from "@/lib/stripe-first-checkout/hold-decision";

const trialEnd = 1_800_000_000;

function intent(overrides: Partial<HoldIntentView> = {}): HoldIntentView {
  return {
    sessionStarted: false,
    holdConfirmed: false,
    holdReleased: false,
    trialConfirmed: true,
    storedHoldCancelAtUnix: null,
    ...overrides,
  };
}

function sub(overrides: Partial<HoldSubscriptionView> = {}): HoldSubscriptionView {
  return {
    status: "trialing",
    cancelAt: null,
    cancelAtPeriodEnd: false,
    trialEnd,
    paused: false,
    ...overrides,
  };
}

describe("stripe-first hold decisions", () => {
  it("applies a hold only from the Stripe trial end", () => {
    expect(decideHold(intent(), sub())).toEqual({ action: "apply", cancelAt: trialEnd });
  });

  it("records a hold Stripe already confirmed", () => {
    expect(decideHold(intent(), sub({ cancelAt: trialEnd }))).toEqual({
      action: "record_hold",
      cancelAt: trialEnd,
    });
  });

  it("does not treat a database confirmation as protection when Stripe has no hold", () => {
    expect(decideHold(intent({ holdConfirmed: true }), sub())).toEqual({
      action: "apply",
      cancelAt: trialEnd,
    });
  });

  it("waits when Stripe still shows the confirmed hold and no session exists", () => {
    expect(
      decideHold(
        intent({ holdConfirmed: true, storedHoldCancelAtUnix: trialEnd }),
        sub({ cancelAt: trialEnd })
      )
    ).toEqual({ action: "wait" });
  });

  it("does not apply a hold after the session has started", () => {
    expect(decideHold(intent({ sessionStarted: true }), sub()).action).not.toBe("apply");
  });

  it("releases only the stored hold after the session exists", () => {
    expect(
      decideHold(
        intent({
          sessionStarted: true,
          holdConfirmed: true,
          storedHoldCancelAtUnix: trialEnd,
        }),
        sub({ cancelAt: trialEnd })
      )
    ).toEqual({ action: "release" });
  });

  it("marks the hold released only after Stripe shows it is gone", () => {
    expect(
      decideHold(
        intent({
          sessionStarted: true,
          holdConfirmed: true,
          storedHoldCancelAtUnix: trialEnd,
        }),
        sub()
      )
    ).toEqual({ action: "mark_released" });
  });

  it("does not call an unconfirmed trial protected", () => {
    expect(
      decideHold(intent({ sessionStarted: true, trialConfirmed: true }), sub())
    ).toEqual({ action: "unprotected" });
  });

  it("preserves an immediate cancellation", () => {
    expect(decideHold(intent({ holdConfirmed: true }), sub({ status: "canceled" }))).toEqual({
      action: "preserve_cancellation",
    });
  });

  it("preserves cancel at period end", () => {
    expect(
      decideHold(
        intent({ sessionStarted: true, holdConfirmed: true, storedHoldCancelAtUnix: trialEnd }),
        sub({ cancelAtPeriodEnd: true, cancelAt: trialEnd + 86_400 })
      )
    ).toEqual({ action: "preserve_cancellation" });
  });

  it("preserves a cancel time that is not the activation hold", () => {
    expect(
      decideHold(
        intent({ holdConfirmed: true, storedHoldCancelAtUnix: trialEnd }),
        sub({ cancelAt: trialEnd + 3600 })
      )
    ).toEqual({ action: "preserve_cancellation" });
  });

  it("clears a hold that is still on Stripe after release was recorded", () => {
    expect(
      decideHold(
        intent({
          sessionStarted: true,
          holdConfirmed: true,
          holdReleased: true,
          storedHoldCancelAtUnix: trialEnd,
        }),
        sub({ cancelAt: trialEnd })
      )
    ).toEqual({ action: "compensate_clear", cancelAt: trialEnd });
  });

  it("does not clear a different cancellation during compensation", () => {
    expect(
      decideHold(
        intent({
          sessionStarted: true,
          holdConfirmed: true,
          holdReleased: true,
          storedHoldCancelAtUnix: trialEnd,
        }),
        sub({ cancelAt: trialEnd + 60 })
      )
    ).toEqual({ action: "preserve_cancellation" });
  });

  it("does not reapply a hold after it was released", () => {
    expect(
      decideHold(
        intent({
          sessionStarted: true,
          holdConfirmed: true,
          holdReleased: true,
          storedHoldCancelAtUnix: trialEnd,
        }),
        sub()
      )
    ).toEqual({ action: "wait" });
  });
});

import { describe, expect, it } from "vitest";
import {
  classifySummittMembership,
  isCheckoutBlockedMembershipClass,
  isPausedFromPublicMetadata,
  isSummittEntitledFromSubscription,
  resolvePlanFromSubscription,
  type SummittSubscriptionLike,
} from "./summitt-subscription-membership";

function sub(
  partial: Partial<SummittSubscriptionLike> & { status: string }
): SummittSubscriptionLike {
  return {
    pause_collection: null,
    items: {
      data: [
        {
          price: {
            id: "price_test",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...partial,
  };
}

describe("classifySummittMembership", () => {
  it("active, no pause → entitled", () => {
    expect(classifySummittMembership(sub({ status: "active" }))).toBe(
      "entitled"
    );
  });

  it("trialing, no pause → entitled", () => {
    expect(classifySummittMembership(sub({ status: "trialing" }))).toBe(
      "entitled"
    );
  });

  it("past_due, no pause → past_due_recoverable", () => {
    expect(classifySummittMembership(sub({ status: "past_due" }))).toBe(
      "past_due_recoverable"
    );
  });

  it("active + pause_collection → paused_recoverable", () => {
    expect(
      classifySummittMembership(
        sub({
          status: "active",
          pause_collection: { behavior: "mark_uncollectible" },
        })
      )
    ).toBe("paused_recoverable");
  });

  it("trialing + pause_collection → paused_recoverable", () => {
    expect(
      classifySummittMembership(
        sub({
          status: "trialing",
          pause_collection: { behavior: "mark_uncollectible" },
        })
      )
    ).toBe("paused_recoverable");
  });

  it("canceled → ended", () => {
    expect(classifySummittMembership(sub({ status: "canceled" }))).toBe(
      "ended"
    );
  });

  it("incomplete_expired → ended", () => {
    expect(
      classifySummittMembership(sub({ status: "incomplete_expired" }))
    ).toBe("ended");
  });

  it("incomplete → other_non_blocking", () => {
    expect(classifySummittMembership(sub({ status: "incomplete" }))).toBe(
      "other_non_blocking"
    );
  });

  it("unpaid → other_non_blocking", () => {
    expect(classifySummittMembership(sub({ status: "unpaid" }))).toBe(
      "other_non_blocking"
    );
  });
});

describe("isSummittEntitledFromSubscription / plan / checkout block", () => {
  it("entitled only when active/trialing without pause", () => {
    expect(isSummittEntitledFromSubscription(sub({ status: "active" }))).toBe(
      true
    );
    expect(
      isSummittEntitledFromSubscription(
        sub({
          status: "active",
          pause_collection: { behavior: "mark_uncollectible" },
        })
      )
    ).toBe(false);
    expect(
      isSummittEntitledFromSubscription(sub({ status: "past_due" }))
    ).toBe(false);
  });

  it("resolves monthly and annual intervals", () => {
    expect(resolvePlanFromSubscription(sub({ status: "active" }))).toBe(
      "monthly"
    );
    expect(
      resolvePlanFromSubscription(
        sub({
          status: "active",
          items: {
            data: [
              {
                price: {
                  id: "price_year",
                  recurring: { interval: "year" },
                },
              },
            ],
          },
        })
      )
    ).toBe("annual");
  });

  it("blocks checkout for entitled, past_due, and paused", () => {
    expect(isCheckoutBlockedMembershipClass("entitled")).toBe(true);
    expect(isCheckoutBlockedMembershipClass("past_due_recoverable")).toBe(
      true
    );
    expect(isCheckoutBlockedMembershipClass("paused_recoverable")).toBe(true);
    expect(isCheckoutBlockedMembershipClass("ended")).toBe(false);
    expect(isCheckoutBlockedMembershipClass("other_non_blocking")).toBe(false);
  });
});

describe("isPausedFromPublicMetadata", () => {
  it("detects summittPlan paused", () => {
    expect(isPausedFromPublicMetadata({ summittPlan: "paused" })).toBe(true);
    expect(
      isPausedFromPublicMetadata({
        summittPlan: "monthly",
        summittSubscribed: false,
      })
    ).toBe(false);
  });
});

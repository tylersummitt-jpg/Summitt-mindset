import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUBSCRIBE_AGAIN_HREF,
  shouldShowSubscribeAgain,
  type SubscribeAgainFacts,
} from "@/lib/subscribe-again-eligibility";
import type { SummittSubscriptionLike } from "@/lib/summitt-subscription-membership";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

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

const endedMd = {
  summittSubscribed: false,
  summittPlan: null,
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_old",
};

function facts(
  override: Partial<SubscribeAgainFacts> & {
    publicMetadata?: Record<string, unknown> | null;
  } = {}
): SubscribeAgainFacts {
  return {
    isNativeApp: false,
    stripeCustomerId: "cus_1",
    publicMetadata: endedMd,
    appleGrantsAccess: false,
    lookupFailed: false,
    linkedSubscription: sub({ status: "canceled" }),
    customerSubscriptions: [],
    ...override,
  };
}

describe("shouldShowSubscribeAgain", () => {
  it("canceled Stripe → yes", () => {
    expect(shouldShowSubscribeAgain(facts())).toBe(true);
  });

  it("incomplete_expired → yes", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({ linkedSubscription: sub({ status: "incomplete_expired" }) })
      )
    ).toBe(true);
  });

  it("historical Stripe customer with no blocking live sub → yes", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          linkedSubscription: null,
          customerSubscriptions: [],
          publicMetadata: {
            summittSubscribed: false,
            stripeCustomerId: "cus_1",
          },
        })
      )
    ).toBe(true);
  });

  it("active Stripe → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: {
            ...endedMd,
            summittSubscribed: true,
            summittPlan: "monthly",
          },
          linkedSubscription: sub({ status: "active" }),
        })
      )
    ).toBe(false);
  });

  it("trialing → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: { ...endedMd, summittSubscribed: true },
          linkedSubscription: sub({ status: "trialing" }),
        })
      )
    ).toBe(false);
  });

  it("active cancel_at_period_end → no (still entitled)", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: { ...endedMd, summittSubscribed: true },
          linkedSubscription: sub({ status: "active" }),
        })
      )
    ).toBe(false);
  });

  it("past_due → no even when Clerk is unsubscribed", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: {
            summittSubscribed: false,
            summittPlan: null,
            stripeCustomerId: "cus_1",
            stripeSubscriptionId: "sub_pd",
          },
          linkedSubscription: sub({ status: "past_due" }),
        })
      )
    ).toBe(false);
  });

  it("past_due on customer list → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          linkedSubscription: sub({ status: "canceled" }),
          customerSubscriptions: [sub({ status: "past_due" })],
        })
      )
    ).toBe(false);
  });

  it("paused → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: {
            summittSubscribed: false,
            summittPlan: "paused",
            stripeCustomerId: "cus_1",
          },
          linkedSubscription: sub({
            status: "active",
            pause_collection: { behavior: "mark_uncollectible" },
          }),
        })
      )
    ).toBe(false);
  });

  it("Apple granting → no", () => {
    expect(shouldShowSubscribeAgain(facts({ appleGrantsAccess: true }))).toBe(
      false
    );
  });

  it("Stripe + Apple granting → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: {
            ...endedMd,
            summittSubscribed: true,
            summittPlan: "monthly",
          },
          appleGrantsAccess: true,
          linkedSubscription: sub({ status: "active" }),
        })
      )
    ).toBe(false);
  });

  it("native iOS / Android → no", () => {
    expect(shouldShowSubscribeAgain(facts({ isNativeApp: true }))).toBe(false);
  });

  it("never subscribed → no", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          stripeCustomerId: null,
          publicMetadata: { summittSubscribed: false },
          linkedSubscription: null,
        })
      )
    ).toBe(false);
  });

  it("Stripe/Apple lookup failure → no", () => {
    expect(shouldShowSubscribeAgain(facts({ lookupFailed: true }))).toBe(false);
  });

  it("does not treat Clerk unsubscribed alone as ended", () => {
    expect(
      shouldShowSubscribeAgain(
        facts({
          publicMetadata: {
            summittSubscribed: false,
            stripeCustomerId: "cus_1",
          },
          linkedSubscription: sub({ status: "past_due" }),
        })
      )
    ).toBe(false);
  });
});

describe("subscribe again wiring", () => {
  const client = read("src/app/user/[[...user]]/user-account-client.tsx");
  const page = read("src/app/user/[[...user]]/page.tsx");
  const helper = read("src/lib/subscribe-again-eligibility.ts");
  const server = read("src/lib/subscribe-again-eligibility.server.ts");

  it("eligible button href is exactly /subscribe", () => {
    expect(SUBSCRIBE_AGAIN_HREF).toBe("/subscribe");
    expect(client).toContain('href={SUBSCRIBE_AGAIN_HREF}');
    expect(client).toContain("Subscribe Again");
    expect(client).not.toMatch(/href=\{`\/subscribe\?/);
  });

  it("does not send Stripe ids from the client", () => {
    expect(client).not.toContain("stripeCustomerId");
    expect(client).not.toContain("stripeSubscriptionId");
    expect(client).not.toContain("create-checkout-session");
  });

  it("hides Manage or Cancel when Subscribe Again is shown", () => {
    expect(client).toContain("!isPaused && !showSubscribeAgain");
    expect(client).toContain("showSubscribeAgain ? (");
    expect(client).toContain("ManageMembershipButton");
  });

  it("page decides eligibility server-side from Stripe + Apple", () => {
    expect(page).toContain("resolveShowSubscribeAgain");
    expect(page).toContain("isNativeSummittMindsetAppRequest");
    expect(server).toContain("resolveAppleMembershipGrantForUser");
    expect(server).toContain("subscriptions.retrieve");
    expect(server).toContain("subscriptions.list");
    expect(helper).toContain("classifySummittMembership");
    expect(helper).toContain("isCheckoutBlockedMembershipClass");
    expect(helper).not.toContain("ended_at");
    expect(helper).not.toContain("canceled_at");
  });

  it("preserves checkout duplicate protection, trial, post-sign-in, and webhook contracts", () => {
    const checkout = read("src/app/api/stripe/create-checkout-session/route.ts");
    expect(checkout).toContain("trial_period_days: 7");
    expect(checkout).toContain("classifySummittMembership");
    expect(checkout).toContain("isCheckoutBlockedMembershipClass");
    expect(checkout).toContain("already_subscribed");

    const post = read("src/app/post-sign-in/page.tsx");
    expect(post).toContain("onboardingCompleted");
    expect(post).toContain("redirect(MEMBER_APP_HOME_PATH)");

    const webhook = read("src/app/api/stripe/webhook/route.ts");
    expect(webhook).toContain("projectMembershipFromEventSubscription");
    expect(webhook).toContain("checkout.session.completed");

    const confirm = read("src/app/api/stripe/confirm-checkout/route.ts");
    expect(confirm).toContain("stripeSubscriptionId: subscription.id");
  });
});

import { describe, expect, it } from "vitest";

import { checkoutPlanFromUnknown } from "@/lib/checkout-plan";
import {
  PARTNER_ANNUAL_UNIT_AMOUNT,
  publicCheckoutOfferMatches,
  resolvePartnerAnnualPrice,
  type StripePriceProof,
} from "@/lib/partner-annual-checkout";
import {
  decidePendingCheckoutAction,
  isReusableOpenCheckoutSession,
} from "@/lib/stripe-pending-checkout-session";

const PARTNER = "price_partner_179";
const MONTHLY = "price_monthly";
const ANNUAL = "price_annual";

function price(overrides: Partial<StripePriceProof> = {}): StripePriceProof {
  return {
    id: PARTNER,
    active: true,
    currency: "usd",
    unitAmount: PARTNER_ANNUAL_UNIT_AMOUNT,
    interval: "year",
    intervalCount: 1,
    productId: "prod_membership",
    livemode: false,
    ...overrides,
  };
}

function retrieve(partner: StripePriceProof | null, monthly: StripePriceProof | null = price({
  id: MONTHLY,
  unitAmount: 2900,
  interval: "month",
})) {
  return async (id: string) => {
    if (id === PARTNER) return partner;
    if (id === MONTHLY) return monthly;
    return null;
  };
}

describe("partner annual price validation", () => {
  it("accepts an active 17900 USD yearly price on the membership product", async () => {
    const result = await resolvePartnerAnnualPrice({
      partnerPriceId: PARTNER,
      monthlyPriceId: MONTHLY,
      annualPriceId: ANNUAL,
      serverLivemode: false,
      retrieve: retrieve(price()),
    });
    expect(result).toEqual({ ok: true, priceId: PARTNER });
  });

  it("fails closed instead of selecting monthly or annual", async () => {
    const missing = await resolvePartnerAnnualPrice({
      partnerPriceId: "  ",
      monthlyPriceId: MONTHLY,
      annualPriceId: ANNUAL,
      serverLivemode: false,
      retrieve: retrieve(price()),
    });
    expect(missing).toEqual({ ok: false, reason: "missing_env" });

    const wrongAmount = await resolvePartnerAnnualPrice({
      partnerPriceId: PARTNER,
      monthlyPriceId: MONTHLY,
      annualPriceId: ANNUAL,
      serverLivemode: false,
      retrieve: retrieve(price({ unitAmount: 24900 })),
    });
    expect(wrongAmount.ok).toBe(false);
    if (!wrongAmount.ok) expect(wrongAmount.reason).toBe("wrong_amount");

    const collision = await resolvePartnerAnnualPrice({
      partnerPriceId: MONTHLY,
      monthlyPriceId: MONTHLY,
      annualPriceId: ANNUAL,
      serverLivemode: false,
      retrieve: retrieve(price()),
    });
    expect(collision).toEqual({ ok: false, reason: "price_collision" });
    expect(checkoutPlanFromUnknown("partner_annual")).toBe("monthly");
  });
});

describe("partner checkout reuse", () => {
  it("does not reuse another partner or channel", () => {
    expect(
      publicCheckoutOfferMatches({
        sessionPlan: "partner_annual",
        sessionPartner: "orange-mountain-designs",
        sessionChannel: "email",
        sessionJourney: null,
        plan: "partner_annual",
        partner: "lady-vol-boost-her-club",
        channel: "email",
        journey: null,
      })
    ).toBe(false);
    expect(
      publicCheckoutOfferMatches({
        sessionPlan: "partner_annual",
        sessionPartner: "orange-mountain-designs",
        sessionChannel: "email",
        sessionJourney: null,
        plan: "partner_annual",
        partner: "orange-mountain-designs",
        channel: "social",
        journey: null,
      })
    ).toBe(false);
    expect(
      publicCheckoutOfferMatches({
        sessionPlan: "partner_annual",
        sessionPartner: "orange-mountain-designs",
        sessionChannel: "email",
        sessionJourney: null,
        plan: "partner_annual",
        partner: "orange-mountain-designs",
        channel: "email",
        journey: null,
      })
    ).toBe(true);
    expect(
      publicCheckoutOfferMatches({
        sessionPlan: "annual",
        sessionJourney: null,
        plan: "annual",
        journey: null,
      })
    ).toBe(true);
  });

  it("does not reuse a signed-in session for the other partner", () => {
    const session = {
      status: "open",
      mode: "subscription",
      url: "https://checkout.stripe.test/open",
      client_reference_id: "user_1",
      metadata: {
        userId: "user_1",
        plan: "partner_annual",
        partner: "orange-mountain-designs",
        partner_channel: "email",
      },
      line_items: { data: [{ price: { id: PARTNER } }] },
    };
    const shared = {
      userId: "user_1",
      plan: "partner_annual" as const,
      channel: "web" as const,
      expectedPriceId: PARTNER,
    };
    expect(
      isReusableOpenCheckoutSession(session, {
        ...shared,
        partner: "orange-mountain-designs",
        partnerChannel: "email",
      })
    ).toBe(true);
    expect(
      isReusableOpenCheckoutSession(session, {
        ...shared,
        partner: "lady-vol-boost-her-club",
        partnerChannel: "email",
      })
    ).toBe(false);
    expect(
      decidePendingCheckoutAction([session], {
        ...shared,
        recognizedPriceIds: new Set([PARTNER]),
        partner: "lady-vol-boost-her-club",
        partnerChannel: "social",
      }).kind
    ).toBe("conflict");
  });
});

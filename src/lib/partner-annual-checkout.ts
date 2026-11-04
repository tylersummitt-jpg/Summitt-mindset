/**
 * Partner annual checkout rules.
 * `partner_annual` never selects the monthly or $249 annual Price.
 */

import { PARTNER_ANNUAL_PLAN } from "@/lib/checkout-plan";

export const PARTNER_ANNUAL_UNIT_AMOUNT = 17900;

export type StripePriceProof = {
  id: string;
  active: boolean;
  currency: string | null;
  unitAmount: number | null;
  interval: string | null;
  intervalCount: number | null;
  productId: string | null;
  livemode: boolean;
};

export type PartnerPriceResult =
  | { ok: true; priceId: string }
  | { ok: false; reason: string };

export function partnerPriceShapeRejection(
  price: StripePriceProof,
  args: { expectedPriceId: string; serverLivemode: boolean }
): string | null {
  if (price.id !== args.expectedPriceId) return "price_mismatch";
  if (!price.active) return "inactive";
  if (price.livemode !== args.serverLivemode) return "livemode_mismatch";
  if ((price.currency ?? "").toLowerCase() !== "usd") return "wrong_currency";
  if (price.unitAmount !== PARTNER_ANNUAL_UNIT_AMOUNT) return "wrong_amount";
  if (price.interval !== "year" || price.intervalCount !== 1) return "wrong_interval";
  if (!price.productId) return "missing_product";
  return null;
}

export async function resolvePartnerAnnualPrice(args: {
  partnerPriceId: string | null | undefined;
  monthlyPriceId: string | null | undefined;
  annualPriceId: string | null | undefined;
  serverLivemode: boolean;
  retrieve: (id: string) => Promise<StripePriceProof | null>;
}): Promise<PartnerPriceResult> {
  const partnerPriceId = args.partnerPriceId?.trim() ?? "";
  const monthlyPriceId = args.monthlyPriceId?.trim() ?? "";
  const annualPriceId = args.annualPriceId?.trim() ?? "";
  if (!partnerPriceId) return { ok: false, reason: "missing_env" };
  if (!monthlyPriceId) return { ok: false, reason: "missing_monthly_price" };
  if (partnerPriceId === monthlyPriceId || (annualPriceId && partnerPriceId === annualPriceId)) {
    return { ok: false, reason: "price_collision" };
  }

  const price = await args.retrieve(partnerPriceId);
  if (!price) return { ok: false, reason: "price_lookup_failed" };
  const rejection = partnerPriceShapeRejection(price, {
    expectedPriceId: partnerPriceId,
    serverLivemode: args.serverLivemode,
  });
  if (rejection) return { ok: false, reason: rejection };

  const monthly = await args.retrieve(monthlyPriceId);
  if (!monthly?.productId) return { ok: false, reason: "membership_product_unknown" };
  if (price.productId !== monthly.productId) return { ok: false, reason: "wrong_product" };
  return { ok: true, priceId: price.id };
}

/**
 * Logged-out Checkout Session reuse. Same plan and journey are not enough
 * when two partners share one Price.
 */
export function publicCheckoutOfferMatches(args: {
  sessionPlan: string | null | undefined;
  sessionPartner?: string | null;
  sessionChannel?: string | null;
  sessionJourney: string | null;
  plan: string;
  partner?: string | null;
  channel?: string | null;
  journey: string | null;
}): boolean {
  if (args.sessionPlan !== args.plan) return false;
  if (args.sessionJourney !== args.journey) return false;
  if (args.plan !== PARTNER_ANNUAL_PLAN) return true;
  return (
    args.sessionPartner === args.partner &&
    (args.sessionChannel || "unknown") === (args.channel || "unknown")
  );
}

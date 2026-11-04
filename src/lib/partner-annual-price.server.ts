import "server-only";

import Stripe from "stripe";

import {
  resolvePartnerAnnualPrice,
  type StripePriceProof,
} from "@/lib/partner-annual-checkout";

function proofFromPrice(price: Stripe.Price): StripePriceProof {
  const product = price.product;
  const productId =
    typeof product === "string" ? product : product && "id" in product ? product.id : null;
  return {
    id: price.id,
    active: price.active,
    currency: price.currency,
    unitAmount: price.unit_amount,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    productId,
    livemode: price.livemode,
  };
}

let successCache: { priceId: string; expiresAt: number } | null = null;

export async function loadValidatedPartnerAnnualPrice(options?: {
  fresh?: boolean;
}): Promise<{ ok: true; priceId: string } | { ok: false; reason: string }> {
  if (!options?.fresh && successCache && successCache.expiresAt > Date.now()) {
    return { ok: true, priceId: successCache.priceId };
  }
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const serverLivemode = secret.startsWith("sk_live_")
    ? true
    : secret.startsWith("sk_test_")
      ? false
      : null;
  if (serverLivemode == null) return { ok: false, reason: "stripe_mode" };

  const stripe = new Stripe(secret);
  const result = await resolvePartnerAnnualPrice({
    partnerPriceId: process.env.STRIPE_PRICE_ID_PARTNER_ANNUAL,
    monthlyPriceId: process.env.STRIPE_PRICE_ID_MONTHLY,
    annualPriceId: process.env.STRIPE_PRICE_ID_ANNUAL,
    serverLivemode,
    retrieve: async (id) => {
      try {
        return proofFromPrice(await stripe.prices.retrieve(id));
      } catch {
        return null;
      }
    },
  });
  if (result.ok) {
    successCache = { priceId: result.priceId, expiresAt: Date.now() + 60_000 };
  }
  return result;
}

export async function partnerAnnualCheckoutReady(): Promise<boolean> {
  try {
    const result = await loadValidatedPartnerAnnualPrice();
    return result.ok;
  } catch {
    console.error("[partner-annual] readiness check failed");
    return false;
  }
}

/**
 * Whether one verified Stripe event may be uploaded to Google Ads.
 * A stored click id is the paid-Google first touch: capture writes it only
 * when the acquisition cookie is source google and paid. This module does
 * not re-read the cookie and does not treat a missing country as US.
 */

import { googleClickIdFromIntent, type GoogleClickId } from "@/lib/marketing-attribution-pure";
import { isUsGoogleAdsUploadEligible } from "@/lib/stripe-first-checkout/request-country";

export type GoogleAdsCheckoutEvidence = {
  livemode?: boolean | null;
  request_country?: string | null;
  google_click_id_type?: string | null;
  google_click_id?: string | null;
};

export type GoogleAdsEligibility =
  | { ok: true; click: GoogleClickId }
  | { ok: false; reason: GoogleAdsIneligibleReason };

export type GoogleAdsIneligibleReason =
  | "owner_canary"
  | "not_livemode"
  | "missing_checkout"
  | "unknown_country"
  | "not_us"
  | "missing_click_id";

export function googleAdsUploadEligibility(args: {
  ownerCanary: boolean;
  subscriptionLivemode: boolean | null | undefined;
  intent: GoogleAdsCheckoutEvidence | null | undefined;
}): GoogleAdsEligibility {
  if (args.ownerCanary) return { ok: false, reason: "owner_canary" };
  if (args.subscriptionLivemode !== true) return { ok: false, reason: "not_livemode" };
  if (!args.intent) return { ok: false, reason: "missing_checkout" };
  if (args.intent.livemode !== true) return { ok: false, reason: "not_livemode" };
  const country = args.intent.request_country;
  if (country == null || country === "") return { ok: false, reason: "unknown_country" };
  if (!isUsGoogleAdsUploadEligible(country)) return { ok: false, reason: "not_us" };
  const click = googleClickIdFromIntent(args.intent);
  if (!click) return { ok: false, reason: "missing_click_id" };
  return { ok: true, click };
}

/**
 * Country for a future US-only Google Ads upload.
 * Vercel sets x-vercel-ip-country from the connecting IP and replaces a
 * client-supplied value. Off Vercel that header is not platform evidence,
 * so it is ignored. No geocoding and no other header is consulted.
 */

const ISO_COUNTRY = /^[A-Z]{2}$/;

export function trustedRequestCountry(args: {
  vercelRuntime: boolean;
  headerValue: string | null;
}): string | null {
  if (!args.vercelRuntime) return null;
  const value = typeof args.headerValue === "string" ? args.headerValue.trim() : "";
  if (!ISO_COUNTRY.test(value)) return null;
  return value;
}

export function trustedRequestCountryFromRequest(request: Request): string | null {
  return trustedRequestCountry({
    vercelRuntime: process.env.VERCEL === "1",
    headerValue: request.headers.get("x-vercel-ip-country"),
  });
}

export function isUsGoogleAdsUploadEligible(
  country: string | null | undefined
): boolean {
  return country === "US";
}

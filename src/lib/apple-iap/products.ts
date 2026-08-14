import "server-only";

/** Locked iOS monthly membership product. Do not add annual/trial SKUs here. */
export const APPLE_IAP_MONTHLY_PRODUCT_ID =
  "com.summittmindset.ios.membership.monthly";

const ALLOWED_APPLE_IAP_PRODUCT_IDS: ReadonlySet<string> = new Set([
  APPLE_IAP_MONTHLY_PRODUCT_ID,
]);

export function isAllowedAppleIapProductId(productId: string): boolean {
  if (typeof productId !== "string") return false;
  const trimmed = productId.trim();
  if (trimmed.length === 0) return false;
  return ALLOWED_APPLE_IAP_PRODUCT_IDS.has(trimmed);
}

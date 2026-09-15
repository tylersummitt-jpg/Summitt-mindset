/**
 * Consumer checkout-hop plan selection.
 * Only the literal string "annual" opts into annual. Everything else is monthly.
 *
 * Plan is a sibling query param on /sign-up and /sign-in — never nested inside
 * redirect_url (the sanitizer rejects /checkout/start?…).
 */

export const CHECKOUT_START_PATH = "/checkout/start";

const CHECKOUT_START_REDIRECT_QUERY = `redirect_url=${encodeURIComponent(CHECKOUT_START_PATH)}`;

export function isAnnualCheckoutPlan(raw: unknown): boolean {
  return raw === "annual";
}

export function checkoutPlanFromUnknown(raw: unknown): "monthly" | "annual" {
  return isAnnualCheckoutPlan(raw) ? "annual" : "monthly";
}

export function checkoutPlanFromSearchValue(
  raw: string | string[] | undefined | null
): "monthly" | "annual" {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return checkoutPlanFromUnknown(value);
}

export function checkoutStartForceRedirectUrl(plan: unknown): string {
  return isAnnualCheckoutPlan(plan)
    ? `${CHECKOUT_START_PATH}?plan=annual`
    : CHECKOUT_START_PATH;
}

export function signUpHrefForCheckoutStart(plan: unknown): string {
  return isAnnualCheckoutPlan(plan)
    ? `/sign-up?plan=annual&${CHECKOUT_START_REDIRECT_QUERY}`
    : `/sign-up?${CHECKOUT_START_REDIRECT_QUERY}`;
}

export function signInHrefForCheckoutStart(plan: unknown): string {
  return isAnnualCheckoutPlan(plan)
    ? `/sign-in?plan=annual&${CHECKOUT_START_REDIRECT_QUERY}`
    : `/sign-in?${CHECKOUT_START_REDIRECT_QUERY}`;
}

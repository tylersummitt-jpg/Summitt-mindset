/**
 * Inactive / unsubscribed membership redirect targets.
 * Native iOS → neutral /app/membership (no purchase).
 * Browser → existing /subscribe purchase surface.
 */

export const APP_MEMBERSHIP_PATH = "/app/membership" as const;
export const BROWSER_SUBSCRIBE_PATH = "/subscribe" as const;

export function inactiveMembershipRedirectPath(
  isNativeSummittMindsetIos: boolean
): typeof APP_MEMBERSHIP_PATH | typeof BROWSER_SUBSCRIBE_PATH {
  return isNativeSummittMindsetIos
    ? APP_MEMBERSHIP_PATH
    : BROWSER_SUBSCRIBE_PATH;
}

export function signInPathForClient(
  isNativeSummittMindsetIos: boolean
): "/app/sign-in" | "/sign-in" {
  return isNativeSummittMindsetIos ? "/app/sign-in" : "/sign-in";
}

/** Checkout API body when native app attempts new Checkout. */
export const NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR =
  "native_app_checkout_unavailable" as const;

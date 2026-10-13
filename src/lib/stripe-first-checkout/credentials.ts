import { CANARY_ENABLED_ENV } from "@/lib/stripe-first-checkout/constants";
import { hostedTestAccessCookieIsValid } from "@/lib/stripe-first-checkout/access-token";

/**
 * Server credential mode. A request parameter cannot select this.
 * Test keys stay on the test path. Live keys stay closed unless the
 * server canary switch is exactly "true".
 */
export function hostedCheckoutCredentialMode(env: {
  stripeSecretKey?: string | null;
  clerkSecretKey?: string | null;
  canaryEnabled?: string | null;
}): "test" | "canary" | "refused" {
  const stripe = env.stripeSecretKey ?? "";
  const clerk = env.clerkSecretKey ?? "";
  if (stripe.startsWith("sk_test_") && clerk.startsWith("sk_test_")) {
    return "test";
  }
  if (
    stripe.startsWith("sk_live_") &&
    clerk.startsWith("sk_live_") &&
    env.canaryEnabled === "true"
  ) {
    return "canary";
  }
  return "refused";
}

export function hostedCheckoutCredentialModeFromEnv(): "test" | "canary" | "refused" {
  return hostedCheckoutCredentialMode({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    canaryEnabled: process.env[CANARY_ENABLED_ENV],
  });
}

/** Test or owner-canary mode, plus the browser authorization cookie. */
export function hostedCheckoutRequestAuthorized(accessToken: string | undefined): boolean {
  return hostedStartAllowed({
    mode: hostedCheckoutCredentialModeFromEnv(),
    accessCookieValid: hostedTestAccessCookieIsValid(
      accessToken,
      process.env.CLERK_SECRET_KEY ?? ""
    ),
  });
}

/** New purchases only. An expired owner cookie or a disabled switch blocks this. */
export function hostedStartAllowed(args: {
  mode: "test" | "canary" | "refused";
  accessCookieValid: boolean;
}): boolean {
  if (!args.accessCookieValid) return false;
  return args.mode === "test" || args.mode === "canary";
}

/**
 * Finish a checkout that already has a stored session.
 * The 30-minute owner cookie is not an input. A success URL without the
 * browser binding is not enough.
 */
export function hostedCompletionAllowed(args: {
  bindingCookiePresent: boolean;
  sessionStored: boolean;
  intentLivemode: boolean;
  serverMode: "test" | "canary" | "refused";
}): boolean {
  if (!args.bindingCookiePresent || !args.sessionStored) return false;
  if (args.serverMode === "test") return args.intentLivemode === false;
  if (args.serverMode === "canary") return args.intentLivemode === true;
  return args.intentLivemode === true;
}

export function hostedCompletionBrowserPresent(
  bindingCookie: string | undefined
): bindingCookie is string {
  return typeof bindingCookie === "string" && bindingCookie.length > 0;
}

/** Same persisted intent retries with one key. Another intent gets another key. */
export function checkoutSessionIdempotencyKey(intentId: string): string {
  const id = intentId.trim();
  if (!id) throw new Error("intent_required");
  return `stripe-first-${id}`;
}

/**
 * One live canary checkout, monthly only. Test mode is unchanged.
 * A browser field is not an input.
 */
export function canaryCheckoutStartAllowed(args: {
  mode: "test" | "canary" | "refused";
  plan: "monthly" | "annual";
  liveIntentExists: boolean;
}): boolean {
  if (args.mode === "test") return true;
  if (args.mode !== "canary") return false;
  return args.plan === "monthly" && !args.liveIntentExists;
}

export function stripeKeyMatchesLivemode(
  stripeSecretKey: string | null | undefined,
  livemode: boolean
): boolean {
  const key = stripeSecretKey ?? "";
  if (livemode) return key.startsWith("sk_live_");
  return key.startsWith("sk_test_");
}

/**
 * Server credential mode. A request parameter cannot select this.
 * Hosted checkout runs only when both providers are the test/development keys.
 */
export function hostedCheckoutCredentialMode(env: {
  stripeSecretKey?: string | null;
  clerkSecretKey?: string | null;
}): "test" | "refused" {
  const stripe = env.stripeSecretKey ?? "";
  const clerk = env.clerkSecretKey ?? "";
  if (stripe.startsWith("sk_test_") && clerk.startsWith("sk_test_")) {
    return "test";
  }
  return "refused";
}

export function hostedCheckoutCredentialModeFromEnv(): "test" | "refused" {
  return hostedCheckoutCredentialMode({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
  });
}

export function stripeKeyMatchesLivemode(
  stripeSecretKey: string | null | undefined,
  livemode: boolean
): boolean {
  const key = stripeSecretKey ?? "";
  if (livemode) return key.startsWith("sk_live_");
  return key.startsWith("sk_test_");
}

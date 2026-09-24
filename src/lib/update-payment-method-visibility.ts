/**
 * Account "Update payment method" visibility.
 * Clerk publicMetadata.stripeCustomerId only. Inactive and past_due members
 * stay eligible. Does not call Stripe.
 */
export function showUpdatePaymentMethodFromMetadata(metadata: unknown): boolean {
  if (metadata == null || typeof metadata !== "object") return false;
  const raw = (metadata as Record<string, unknown>).stripeCustomerId;
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Pure guards for Clerk `publicMetadata` subscription signals — no throws for unusual shapes.
 * Used by onboarding layout/page gates only (not Stripe/subscription activation).
 */

export function isSubscribedFromPublicMetadata(metadata: unknown): boolean {
  if (metadata == null || typeof metadata !== "object") {
    return false;
  }

  const md = metadata as Record<string, unknown>;
  const subscribedRaw = md.summittSubscribed;
  const plan = md.summittPlan;

  const subscribedTruthy = subscribedRaw === true || subscribedRaw === "true";
  const planStr = typeof plan === "string" ? plan : "";
  const planOk = planStr === "monthly" || planStr === "annual";

  return subscribedTruthy || planOk;
}

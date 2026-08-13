/**
 * Shared MMS ingest eligibility (Slice A2 hardening).
 * Mirrors existing Twilio inbound coach opt-out gates — not a new product model.
 *
 * Media may be durably recorded only when the identity is texting-enabled:
 * - sms_identities.sms_enabled === true
 * - sms_identities.stopped_at is not set
 * - Clerk public metadata smsEnabled === true
 *
 * Does NOT require: Body, active commitment, coach-generation readiness,
 * or summitt_subscribed (inbound route does not gate coach on those today).
 *
 * Account deletion is a SEPARATE media-only gate
 * (see isInboundMediaEnqueueAllowedByAccountDeletion). Opt-out eligibility
 * here does not imply deletion clearance; coach inbound may still run while
 * media enqueue is suppressed during unresolved deletion.
 */

export type InboundMediaEnqueueEligibilityInput = {
  identitySmsEnabled: unknown;
  identityStoppedAt: unknown;
  clerkSmsEnabled: unknown;
};

export function canEnqueueInboundMedia(
  args: InboundMediaEnqueueEligibilityInput
): boolean {
  if (args.identitySmsEnabled !== true) return false;
  if (typeof args.identityStoppedAt === "string") return false;
  if (args.clerkSmsEnabled !== true) return false;
  return true;
}

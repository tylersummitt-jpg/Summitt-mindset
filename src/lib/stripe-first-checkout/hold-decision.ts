import { UNPROTECTED_ALERTED_METADATA_KEY } from "@/lib/stripe-first-checkout/constants";

/**
 * Pure hold decision. A database flag is not proof that Stripe is protecting
 * the trial. Stripe's subscription is the only confirmation.
 */

export type HoldSubscriptionView = {
  status: string;
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  paused: boolean;
};

export type HoldIntentView = {
  sessionStarted: boolean;
  holdConfirmed: boolean;
  holdReleased: boolean;
  trialConfirmed: boolean;
  storedHoldCancelAtUnix: number | null;
};

export type HoldDecision =
  | { action: "apply"; cancelAt: number }
  | { action: "record_hold"; cancelAt: number }
  | { action: "release" }
  | { action: "mark_released" }
  | { action: "preserve_cancellation" }
  | { action: "compensate_clear"; cancelAt: number }
  | { action: "unprotected" }
  | { action: "wait" };

export function unprotectedAlertAlreadySent(
  metadata: Record<string, string> | null | undefined,
  intentId: string
): boolean {
  return metadata?.[UNPROTECTED_ALERTED_METADATA_KEY] === intentId;
}

export function unixFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function entitled(sub: HoldSubscriptionView): boolean {
  return (sub.status === "trialing" || sub.status === "active") && !sub.paused;
}

function ourHoldUnix(intent: HoldIntentView, sub: HoldSubscriptionView): number | null {
  return intent.storedHoldCancelAtUnix ?? sub.trialEnd;
}

function isOurHold(intent: HoldIntentView, sub: HoldSubscriptionView): boolean {
  if (sub.cancelAt == null) return false;
  const holdUnix = ourHoldUnix(intent, sub);
  return holdUnix != null && sub.cancelAt === holdUnix;
}

function customerCanceled(intent: HoldIntentView, sub: HoldSubscriptionView): boolean {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return true;
  if (sub.cancelAtPeriodEnd) return true;
  if (sub.cancelAt == null) return false;
  if (isOurHold(intent, sub)) return false;
  return true;
}

export function decideHold(
  intent: HoldIntentView,
  sub: HoldSubscriptionView
): HoldDecision {
  if (customerCanceled(intent, sub)) {
    return { action: "preserve_cancellation" };
  }

  if (intent.holdReleased) {
    if (
      intent.storedHoldCancelAtUnix != null &&
      sub.cancelAt === intent.storedHoldCancelAtUnix
    ) {
      return { action: "compensate_clear", cancelAt: intent.storedHoldCancelAtUnix };
    }
    return { action: "wait" };
  }

  if (intent.sessionStarted) {
    if (!entitled(sub)) return { action: "wait" };
    if (isOurHold(intent, sub)) return { action: "release" };
    if (sub.cancelAt == null && intent.holdConfirmed) return { action: "mark_released" };
    if (sub.cancelAt == null && !intent.holdConfirmed) return { action: "unprotected" };
    return { action: "preserve_cancellation" };
  }

  if (!intent.trialConfirmed || !entitled(sub)) return { action: "wait" };

  if (sub.trialEnd == null) {
    return sub.cancelAt == null
      ? { action: "unprotected" }
      : { action: "preserve_cancellation" };
  }

  if (sub.cancelAt === sub.trialEnd) {
    return intent.holdConfirmed
      ? { action: "wait" }
      : { action: "record_hold", cancelAt: sub.trialEnd };
  }

  if (sub.cancelAt == null) {
    return { action: "apply", cancelAt: sub.trialEnd };
  }

  return { action: "preserve_cancellation" };
}

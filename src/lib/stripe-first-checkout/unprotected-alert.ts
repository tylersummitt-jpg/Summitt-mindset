import "server-only";

import { Resend } from "resend";

/**
 * Staff alert for a Stripe trial whose cancellation hold is not confirmed.
 * Uses the existing internal notify inbox. This is not a customer email.
 * Returns false when the alert was not sent, so the caller can try again.
 */
export async function notifyUnprotectedStripeTrial(args: {
  intentId: string;
  subscriptionId: string;
  livemode: boolean;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();
  if (!apiKey || !to) {
    console.error("[stripe-first] unprotected trial alert was not sent", {
      intentId: args.intentId,
      subscriptionId: args.subscriptionId,
      livemode: args.livemode,
      reason: !apiKey ? "RESEND_API_KEY missing" : "COACH_KIT_NOTIFY_EMAIL missing",
    });
    return false;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() || "challenge@summittmindset.com";
  const mode = args.livemode ? "live" : "test";
  const text = [
    "A Stripe trial completed without a confirmed cancellation hold.",
    "The trial was not marked protected.",
    "Open this subscription in Stripe and confirm cancel_at before the trial ends.",
    "Do not remove a cancellation the customer chose.",
    "",
    `Mode: ${mode}`,
    `Checkout intent: ${args.intentId}`,
    `Stripe subscription: ${args.subscriptionId}`,
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to,
      subject: `Unprotected Stripe trial — ${args.subscriptionId}`,
      text,
    });
    return true;
  } catch (err) {
    console.error("[stripe-first] unprotected trial alert failed", {
      intentId: args.intentId,
      subscriptionId: args.subscriptionId,
      reason: err instanceof Error ? err.message : "alert_failed",
    });
    return false;
  }
}

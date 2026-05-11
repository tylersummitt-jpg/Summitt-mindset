import { Resend } from "resend";

export type CoachSubscriptionPlan = "monthly" | "annual" | "unknown";

export type NotifyCoachSubscribedInternalArgs = {
  coachName: string;
  coachEmail: string;
  clerkUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: CoachSubscriptionPlan;
  source: "coach";
  timestamp: string;
};

/**
 * Internal alert when a coach completes Stripe Checkout subscription (webhook only).
 * Fail-soft: never throws; webhook must succeed even if email fails.
 */
export async function notifyCoachSubscribedInternal(
  args: NotifyCoachSubscribedInternalArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();

  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY missing, skipping coach subscription notification"
    );
    return;
  }

  if (!to) {
    console.warn(
      "COACH_KIT_NOTIFY_EMAIL missing, skipping coach subscription notification"
    );
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() ||
    "challenge@summittmindset.com";

  const subject = "New coach subscribed — Leadership Kit follow-up needed";

  const text = [
    "A sports coach just subscribed to Summitt Mindset.",
    "",
    `Coach name: ${args.coachName}`,
    `Coach email: ${args.coachEmail}`,
    `Clerk user ID: ${args.clerkUserId}`,
    `Stripe customer ID: ${args.stripeCustomerId}`,
    `Stripe subscription ID: ${args.stripeSubscriptionId}`,
    `Plan: ${args.plan}`,
    `Source: ${args.source}`,
    `Subscribed at: ${args.timestamp}`,
    "",
    "Next step:",
    "They still need to complete onboarding. After onboarding, reach out to customize and ship their Pat Summitt Leadership Kit. Shipping is covered.",
  ].join("\n");

  const html = `
    <p>A sports coach just subscribed to Summitt Mindset.</p>
    <ul style="list-style:none;padding-left:0;line-height:1.6;">
      <li><strong>Coach name:</strong> ${escapeHtml(args.coachName)}</li>
      <li><strong>Coach email:</strong> ${escapeHtml(args.coachEmail)}</li>
      <li><strong>Clerk user ID:</strong> ${escapeHtml(args.clerkUserId)}</li>
      <li><strong>Stripe customer ID:</strong> ${escapeHtml(args.stripeCustomerId)}</li>
      <li><strong>Stripe subscription ID:</strong> ${escapeHtml(args.stripeSubscriptionId)}</li>
      <li><strong>Plan:</strong> ${escapeHtml(args.plan)}</li>
      <li><strong>Source:</strong> ${escapeHtml(args.source)}</li>
      <li><strong>Subscribed at:</strong> ${escapeHtml(args.timestamp)}</li>
    </ul>
    <p><strong>Next step:</strong></p>
    <p>They still need to complete onboarding. After onboarding, reach out to customize and ship their Pat Summitt Leadership Kit. Shipping is covered.</p>
  `;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.warn("Coach subscription notification email failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

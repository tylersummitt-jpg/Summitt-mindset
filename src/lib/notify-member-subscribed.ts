import { Resend } from "resend";

export type MemberSubscriptionPlan = "monthly" | "annual" | "unknown";

export type NotifyMemberSubscribedInternalArgs = {
  memberName: string;
  memberEmail: string;
  memberPhone: string;
  clerkUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  checkoutSessionId: string;
  plan: MemberSubscriptionPlan;
  timestamp: string;
};

function resolveSubjectLabel(args: NotifyMemberSubscribedInternalArgs): string {
  if (args.memberName !== "not provided") return args.memberName;
  if (args.memberEmail !== "not found") return args.memberEmail;
  return "unknown";
}

/**
 * Internal alert when a regular member completes Stripe Checkout subscription (webhook only).
 * Fail-soft: never throws; webhook must succeed even if email fails.
 */
export async function notifyMemberSubscribedInternal(
  args: NotifyMemberSubscribedInternalArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();

  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY missing, skipping member subscription notification"
    );
    return;
  }

  if (!to) {
    console.warn(
      "COACH_KIT_NOTIFY_EMAIL missing, skipping member subscription notification"
    );
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() ||
    "challenge@summittmindset.com";

  const subject = `Reach out to new member — ${resolveSubjectLabel(args)}`;

  const text = [
    "New Summitt Mindset member signed up.",
    "",
    `Name: ${args.memberName}`,
    `Email: ${args.memberEmail}`,
    `Phone: ${args.memberPhone}`,
    `Clerk user ID: ${args.clerkUserId}`,
    `Stripe customer ID: ${args.stripeCustomerId}`,
    `Stripe subscription ID: ${args.stripeSubscriptionId}`,
    `Subscription status: ${args.subscriptionStatus}`,
    `Plan: ${args.plan}`,
    `Checkout session ID: ${args.checkoutSessionId}`,
    `Timestamp: ${args.timestamp}`,
    "",
    "Reach out to new member.",
  ].join("\n");

  const html = `
    <p><strong>New Summitt Mindset member signed up.</strong></p>
    <ul style="list-style:none;padding-left:0;line-height:1.6;">
      <li><strong>Name:</strong> ${escapeHtml(args.memberName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(args.memberEmail)}</li>
      <li><strong>Phone:</strong> ${escapeHtml(args.memberPhone)}</li>
      <li><strong>Clerk user ID:</strong> ${escapeHtml(args.clerkUserId)}</li>
      <li><strong>Stripe customer ID:</strong> ${escapeHtml(args.stripeCustomerId)}</li>
      <li><strong>Stripe subscription ID:</strong> ${escapeHtml(args.stripeSubscriptionId)}</li>
      <li><strong>Subscription status:</strong> ${escapeHtml(args.subscriptionStatus)}</li>
      <li><strong>Plan:</strong> ${escapeHtml(args.plan)}</li>
      <li><strong>Checkout session ID:</strong> ${escapeHtml(args.checkoutSessionId)}</li>
      <li><strong>Timestamp:</strong> ${escapeHtml(args.timestamp)}</li>
    </ul>
    <p><strong>Reach out to new member.</strong></p>
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
    console.warn("Member subscription notification email failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

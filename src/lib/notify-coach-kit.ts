import { Resend } from "resend";

export type NotifyCoachKitArgs = {
  clerkUserId: string;
  email: string;
  fullName: string;
  /** Single-line summary for internal email (full address lines). */
  addressSummary: string;
};

/**
 * Internal notification when a coach submits a Leadership Kit shipping address.
 * Fails gracefully: logs warning, does not throw (caller already persisted data).
 */
export async function notifyCoachKitSubmitted(
  args: NotifyCoachKitArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();

  if (!apiKey) {
    console.warn("RESEND_API_KEY missing, skipping coach kit notification");
    return;
  }

  if (!to) {
    console.warn("COACH_KIT_NOTIFY_EMAIL missing, skipping coach kit notification");
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() ||
    "challenge@summittmindset.com";

  const subject = "Coach Leadership Kit — address submitted";
  const text = [
    "A coach submitted a shipping address for the Leadership Kit.",
    "",
    `Clerk user id: ${args.clerkUserId}`,
    `Email: ${args.email}`,
    `Name: ${args.fullName}`,
    "",
    "Address:",
    args.addressSummary,
  ].join("\n");

  const html = `
    <p><strong>Coach Leadership Kit — address submitted</strong></p>
    <p>Clerk user id: ${escapeHtml(args.clerkUserId)}</p>
    <p>Email: ${escapeHtml(args.email)}</p>
    <p>Name: ${escapeHtml(args.fullName)}</p>
    <p><strong>Address</strong></p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(
      args.addressSummary
    )}</pre>
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
    console.warn("Coach kit notification email failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

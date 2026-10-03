import { Resend } from "resend";

export type NotifySmsOptOutReviewNeededArgs = {
  preferredName: string | null;
  triggeringText: string;
  messageSid: string;
};

/**
 * Internal alert when a likely full-SMS opt-out is waiting for Tyler.
 * Fail-soft: logs and returns; never throws. No database writes.
 * The hold is the source of truth, not this email.
 */
export async function notifySmsOptOutReviewNeeded(
  args: NotifySmsOptOutReviewNeededArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();

  if (!apiKey) {
    console.warn("[notify-sms-opt-out-review] notification_failed", {
      message_sid: args.messageSid,
      reason: "RESEND_API_KEY missing",
    });
    return;
  }

  if (!to) {
    console.warn("[notify-sms-opt-out-review] notification_failed", {
      message_sid: args.messageSid,
      reason: "COACH_KIT_NOTIFY_EMAIL missing",
    });
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() ||
    "challenge@summittmindset.com";

  const memberName = args.preferredName?.trim() || "A member";
  const triggeringText = args.triggeringText.trim() || "(empty)";
  const messageSid = args.messageSid.trim();
  const reviewUrl = smsOptOutReviewUrl(messageSid);

  const subject = `SMS Opt-Out Review Needed — ${memberName}`;
  const text = [
    `Member: ${memberName}`,
    "",
    "They said:",
    triggeringText,
    "",
    "Morning, Evening, and Weekly texts are currently being held.",
    "",
    `Review: ${reviewUrl}`,
  ].join("\n");

  const html = `
    <p><strong>Member:</strong> ${escapeHtml(memberName)}</p>
    <p><strong>They said:</strong></p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(triggeringText)}</pre>
    <p>Morning, Evening, and Weekly texts are currently being held.</p>
    <p><a href="${escapeHtml(reviewUrl)}">Open the SMS opt-out review</a></p>
  `;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      subject,
      text,
      html,
    });
    if (result.error) {
      console.warn("[notify-sms-opt-out-review] notification_failed", {
        message_sid: messageSid,
        error:
          typeof result.error.message === "string"
            ? result.error.message
            : "Resend send failed",
      });
      return;
    }
    const resendId =
      result.data && typeof result.data.id === "string" ? result.data.id : null;
    console.info("[notify-sms-opt-out-review] notification_sent", {
      message_sid: messageSid,
      resend_id: resendId,
    });
  } catch (err) {
    console.warn("[notify-sms-opt-out-review] notification_failed", {
      message_sid: messageSid,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function smsOptOutReviewUrl(messageSid: string): string {
  const path = `/admin/sms-opt-out-reviews?message_sid=${encodeURIComponent(messageSid.trim())}`;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ?? "";
  return base ? `${base}${path}` : path;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

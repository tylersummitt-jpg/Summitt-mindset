import { Resend } from "resend";
import { sanitizeProviderError } from "@/lib/challenge-send-outcome";
import type { ChallengeAttentionAlert } from "@/lib/challenge-send-outcome";

/**
 * One internal note when a challenge lesson first needs a person.
 * Fail-soft: logs and returns. Never throws. Does not include the participant email.
 */
export async function notifyChallengeDeliveryAttention(
  alert: ChallengeAttentionAlert
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();
  const logged = {
    participantId: alert.participantId,
    day: alert.challengeDay,
    attention: alert.failureType,
  };

  if (!apiKey) {
    console.error("[challenge] attention_notification_failed", {
      ...logged,
      message: "RESEND_API_KEY missing",
    });
    return;
  }

  if (!to) {
    console.error("[challenge] attention_notification_failed", {
      ...logged,
      message: "COACH_KIT_NOTIFY_EMAIL missing",
    });
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() || "challenge@summittmindset.com";
  const errorText = alert.error?.trim() || "none recorded";
  const subject = `Challenge lesson needs attention — day ${alert.challengeDay}`;
  const text = [
    `Participant ID: ${alert.participantId}`,
    `Challenge day: ${alert.challengeDay}`,
    `Failure: ${alert.failureType}`,
    `Error: ${errorText}`,
    `Retry safe: ${alert.retryReason}`,
  ].join("\n");
  const html = `
    <p><strong>Participant ID:</strong> ${escapeHtml(alert.participantId)}</p>
    <p><strong>Challenge day:</strong> ${alert.challengeDay}</p>
    <p><strong>Failure:</strong> ${escapeHtml(alert.failureType)}</p>
    <p><strong>Error:</strong> ${escapeHtml(errorText)}</p>
    <p><strong>Retry safe:</strong> ${escapeHtml(alert.retryReason)}</p>
  `;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject, text, html });
    if (result.error) {
      console.error("[challenge] attention_notification_failed", {
        ...logged,
        message: sanitizeProviderError(result.error.message) ?? "Resend send failed",
      });
      return;
    }
    console.info("[challenge] attention_notification_sent", logged);
  } catch (err) {
    console.error("[challenge] attention_notification_failed", {
      ...logged,
      message: sanitizeProviderError(err),
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

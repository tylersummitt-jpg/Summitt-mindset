import { Resend } from "resend";

export type NotifyManualPatAnswerNeededArgs = {
  preferredName: string | null;
  question: string;
  messageSid: string;
  occurredAt: string;
};

/**
 * Internal ops email when an inbound Coach Pat question is parked for a manual answer.
 * Fail-soft: logs and returns; never throws. No database writes.
 */
export async function notifyManualPatAnswerNeeded(
  args: NotifyManualPatAnswerNeededArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();

  if (!apiKey) {
    console.warn(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
      { message_sid: args.messageSid, reason: "RESEND_API_KEY missing" }
    );
    return;
  }

  if (!to) {
    console.warn(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
      { message_sid: args.messageSid, reason: "COACH_KIT_NOTIFY_EMAIL missing" }
    );
    return;
  }

  const from =
    process.env.COACH_KIT_NOTIFY_FROM?.trim() ||
    "challenge@summittmindset.com";

  const memberName = args.preferredName?.trim() || "(not provided)";
  const question = args.question.trim() || "(empty)";
  const occurredAt = args.occurredAt.trim() || "(unknown)";
  const messageSid = args.messageSid.trim();

  const subject = "Coach Pat question needs your answer";
  const text = [
    "A member asked Coach Pat something that needs your answer.",
    "",
    `Member: ${memberName}`,
    "",
    "Question:",
    question,
    "",
    `Received at: ${occurredAt}`,
    `Message SID: ${messageSid}`,
    "",
    "This inbound is waiting for a manual Pat answer. No SMS was sent.",
  ].join("\n");

  const html = `
    <p><strong>Coach Pat question needs your answer</strong></p>
    <p>A member asked Coach Pat something that needs your answer.</p>
    <p><strong>Member:</strong> ${escapeHtml(memberName)}</p>
    <p><strong>Question:</strong></p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(question)}</pre>
    <p><strong>Received at:</strong> ${escapeHtml(occurredAt)}</p>
    <p><strong>Message SID:</strong> ${escapeHtml(messageSid)}</p>
    <p>This inbound is waiting for a manual Pat answer. No SMS was sent.</p>
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
      console.warn(
        "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
        {
          message_sid: messageSid,
          error:
            typeof result.error.message === "string"
              ? result.error.message
              : "Resend send failed",
        }
      );
      return;
    }
    const resendId =
      result.data && typeof result.data.id === "string" ? result.data.id : null;
    console.info(
      "[notify-manual-pat-answer] manual_pat_answer_notification_sent",
      { message_sid: messageSid, resend_id: resendId }
    );
  } catch (err) {
    console.warn(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
      {
        message_sid: messageSid,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

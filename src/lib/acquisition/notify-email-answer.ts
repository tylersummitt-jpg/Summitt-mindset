import { Resend } from "resend";

import { emailAnswerAdminUrl } from "@/lib/acquisition/email-manual-answer";

export async function notifyAcquisitionEmailAnswer(args: {
  requestId: string;
  missingReason: string;
}): Promise<{ ok: true; resendId: string | null } | { ok: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.COACH_KIT_NOTIFY_EMAIL?.trim();
  if (!apiKey) return { ok: false, reason: "missing_credentials" };
  if (!to) return { ok: false, reason: "missing_recipient" };
  const from = process.env.COACH_KIT_NOTIFY_FROM?.trim() || "challenge@summittmindset.com";
  const reason = args.missingReason.trim().slice(0, 240) || "A verified fact is missing.";
  const url = emailAnswerAdminUrl(args.requestId);
  const subject = "An email question needs your answer";
  const text = [
    "A prospect asked something the email assistant cannot answer from verified facts.",
    "",
    "Missing information:",
    reason,
    "",
    url,
    "",
    "No email was sent to the prospect.",
  ].join("\n");
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject, text });
    if (result.error) {
      return { ok: false, reason: typeof result.error.message === "string" ? result.error.message.slice(0, 240) : "resend_failed" };
    }
    const resendId = result.data && typeof result.data.id === "string" ? result.data.id : null;
    return { ok: true, resendId };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 240) : "resend_failed" };
  }
}

import { Resend } from "resend";
import { challengeLessons } from "@/lib/challenge-lessons";
import {
  classifyResendSend,
  missingLessonResult,
  providerNotConfiguredResult,
} from "@/lib/challenge-send-outcome";
import { CHALLENGE_ORIGIN } from "@/lib/challenge-types";
import type { ChallengeProviderResult } from "@/lib/challenge-types";

type ChallengeSendClient = {
  emails: {
    send: (
      payload: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
        headers?: Record<string, string>;
      },
      options?: { idempotencyKey?: string }
    ) => Promise<{
      data: { id: string } | null;
      error: { message: string; statusCode: number | null; name: string } | null;
    }>;
  };
};

export type SendChallengeEmailArgs = {
  to: string;
  day: number;
  idempotencyKey: string;
  unsubscribeToken: string;
  resend?: ChallengeSendClient;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function challengeUnsubscribePageUrl(token: string): string {
  return `${CHALLENGE_ORIGIN}/challenge/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function challengeUnsubscribeApiUrl(token: string): string {
  return `${CHALLENGE_ORIGIN}/api/challenge/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Ask Resend to accept one challenge lesson.
 * A returned message id means the provider accepted the request, not that the inbox received it.
 * The same idempotency key must be reused when the outcome is unknown.
 */
export async function sendChallengeEmail(
  args: SendChallengeEmailArgs
): Promise<ChallengeProviderResult> {
  const lesson = challengeLessons.find((item) => item.day === args.day);
  if (!lesson) return missingLessonResult();

  const apiKey = process.env.RESEND_API_KEY;
  if (!args.resend && !apiKey) return providerNotConfiguredResult();

  const pageUrl = challengeUnsubscribePageUrl(args.unsubscribeToken);
  const oneClickUrl = challengeUnsubscribeApiUrl(args.unsubscribeToken);
  const lessonUrl = `${CHALLENGE_ORIGIN}/challenge/day/${lesson.day}`;
  const privacyUrl = `${CHALLENGE_ORIGIN}/privacy`;
  const subject = `Day ${lesson.day} — ${lesson.title}`;

  const text = [
    `Day ${lesson.day} — ${lesson.title}`,
    "",
    `Watch today's leadership lesson: ${lessonUrl}`,
    "",
    "Today's Challenge",
    lesson.challenge,
    "",
    "If you’re enjoying the challenge, Summitt Mindset helps leaders build",
    "daily leadership habits inspired by Pat Summitt.",
    "Start your free trial: https://summittmindset.com/subscribe",
    "",
    "You asked for seven challenge emails. This is not an ongoing newsletter.",
    `Unsubscribe: ${pageUrl}`,
    `Privacy: ${privacyUrl}`,
  ].join("\n");

  const html = `
    <h2>Day ${lesson.day}: ${escapeHtml(lesson.title)}</h2>
    <p>Watch today's leadership lesson:</p>
    <a href="${escapeHtml(lessonUrl)}">
      <img
        src="${escapeHtml(lesson.thumbnail)}"
        width="600"
        alt=""
        style="max-width:100%;border-radius:8px;display:block;margin:0 auto;"
      />
    </a>
    <p style="margin-top:16px;">
      <a href="${escapeHtml(lessonUrl)}" style="font-weight:bold;">
        Watch Today's Lesson →
      </a>
    </p>
    <h3>Today's Challenge</h3>
    <p>${escapeHtml(lesson.challenge)}</p>
    <hr />
    <p>
      If you’re enjoying the challenge, Summitt Mindset helps leaders build
      daily leadership habits inspired by Pat Summitt.
    </p>
    <p>
      <a href="https://summittmindset.com/subscribe">
        Start your free trial
      </a>
    </p>
    <p style="margin-top:24px;font-size:13px;color:#555;">
      You asked for seven challenge emails. This is not an ongoing newsletter.
      <a href="${escapeHtml(pageUrl)}">Unsubscribe</a>
      ·
      <a href="${escapeHtml(privacyUrl)}">Privacy</a>
    </p>
  `;

  const payload = {
    from: "challenge@summittmindset.com",
    to: args.to,
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  const options = { idempotencyKey: args.idempotencyKey };
  try {
    const result = args.resend
      ? await args.resend.emails.send(payload, options)
      : await new Resend(apiKey as string).emails.send(payload, options);
    return classifyResendSend({ result });
  } catch (err) {
    return classifyResendSend({ threw: err });
  }
}

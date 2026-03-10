import { Resend } from "resend";
import { challengeLessons } from "@/lib/challenge-lessons";

export async function sendChallengeEmail(email: string, day: number) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn("RESEND_API_KEY missing, skipping challenge email");
    return;
  }

  const resend = new Resend(resendApiKey);

  const lesson = challengeLessons.find((l) => l.day === day);
  if (!lesson) {
    throw new Error(`No lesson found for day ${day}`);
  }

  const subject = `Day ${lesson.day} — ${lesson.title}`;
  const challengeUrl = `https://summittmindset.com/challenge/day/${day}`;

  const text = [
    `Day ${lesson.day} — ${lesson.title}`,
    "",
    `Watch today's leadership lesson: ${challengeUrl}`,
    "",
    "Today's Challenge",
    lesson.challenge,
    "",
    "If you’re enjoying the challenge, Summitt Mindset helps leaders build",
    "daily leadership habits inspired by Pat Summitt.",
    "Start your free trial: https://summittmindset.com/subscribe",
  ].join("\n");

  const html = `
    <h2>Day ${lesson.day}: ${lesson.title}</h2>
    <p>Watch today's leadership lesson:</p>
    <a href="${challengeUrl}">
      <img
        src="${lesson.thumbnail}"
        width="600"
        style="max-width:100%;border-radius:8px;display:block;margin:0 auto;"
      />
    </a>
    <p style="margin-top:16px;">
      <a href="${challengeUrl}" style="font-weight:bold;">
        Watch Today's Lesson →
      </a>
    </p>
    <h3>Today's Challenge</h3>
    <p>${lesson.challenge}</p>
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
  `;

  await resend.emails.send({
    from: "challenge@summittmindset.com",
    to: email,
    subject,
    text,
    html,
  });
}

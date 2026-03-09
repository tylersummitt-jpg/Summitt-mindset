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
  const text = [
    `Day ${lesson.day} — ${lesson.title}`,
    "",
    "Lesson",
    lesson.lesson,
    "",
    "Reflection",
    lesson.reflection,
    "",
    "Action",
    lesson.action,
  ].join("\n");

  await resend.emails.send({
    from: "challenge@summittmindset.com",
    to: email,
    subject,
    text,
  });
}

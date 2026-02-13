import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

import DayClient from "./day-client";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import { generateDailyCoachPatMessage } from "@/lib/daily-coach-pat-engine";

type PageProps = {
  params: Promise<{ day: string }>;
};

function safeDayNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

/**
 * ======================================================
 * Day Page (SERVER-RENDERED COACH NOTE)
 * ======================================================
 *
 * Responsibilities:
 * - Validate day param
 * - Resolve canonical practice
 * - Generate Coach Pat note (server-side, once)
 * - Pass everything into DayClient
 *
 * Coach note rules:
 * - Only generate for current day
 * - Past days never regenerate notes
 * - No client fetch
 * - No loading state
 */

export default async function DayPage({ params }: PageProps) {
  const { day } = await params;
  const requestedDay = safeDayNumber(day);
  if (!requestedDay) redirect("/dashboard");

  const { userId } = await auth();
  if (!userId) redirect("/dashboard");

  const user = await currentUser();
  if (!user) redirect("/dashboard");

  const md = (user.publicMetadata || {}) as Record<string, any>;

  const currentDay =
    typeof md.currentDay === "number" && md.currentDay > 0
      ? md.currentDay
      : 1;

  // Safety: block forward navigation
  if (requestedDay > currentDay) {
    redirect(`/dashboard/day/${currentDay}`);
  }

  // --------------------------------------------------
  // Resolve canonical practice
  // --------------------------------------------------
  let practice;
  try {
    practice = await resolveDailyPracticeForUser(userId, requestedDay);
  } catch {
    redirect(`/dashboard/day/${currentDay}`);
  }

  // --------------------------------------------------
  // Generate Coach Pat note (CURRENT DAY ONLY)
  // --------------------------------------------------
  let coachNote = "";

  if (requestedDay === currentDay) {
    const coachResult = await generateDailyCoachPatMessage({
      userId,
      dayNumber: requestedDay,
    });

    if (coachResult.ok) {
      coachNote = coachResult.note;
    } else {
      // Calm fallback — never break the page
      coachNote =
        "Keep it simple today. Show up. Hold the standard in small moments.";
    }
  }

  return (
    <main className="max-w-2xl mx-auto py-14 px-5 sm:px-6 space-y-10">
      <DayClient
        dayNumber={practice.currentDay}
        promptId={practice.promptId}
        coachNote={coachNote}
        actionItem={practice.actionItem}
        reflectionPrompt={practice.reflectionPrompt}
        video={practice.video}
        canonicalCurrentDay={currentDay}
      />
    </main>
  );
}

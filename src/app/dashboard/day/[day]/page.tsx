import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

import DayClient from "./day-client";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import { getOrCreateDailyCoachPatNote } from "@/lib/get-or-create-daily-coach-pat-note";

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
 * Day Page (CANONICAL COACH NOTE)
 * ======================================================
 *
 * CRITICAL RULE:
 * - App and SMS must use the exact same note generator.
 * - No alternate pathways.
 * - No client fetching.
 * - No regeneration on refresh.
 *
 * Only getOrCreateDailyCoachPatNote is allowed.
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
  // Canonical Coach Pat Note
  // --------------------------------------------------
  let coachNote = "";

  if (requestedDay === currentDay) {
    try {
      const result = await getOrCreateDailyCoachPatNote({
        userId,
        dayNumber: requestedDay,
      });

      coachNote = result.noteText;
    } catch (err) {
      console.error("Coach note error:", err);

      // Calm fallback — page must never break
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
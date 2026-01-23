import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

import DayClient from "./day-client";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import { generateCoachPatNote } from "@/lib/coach-pat-generator";

/**
 * ======================================================
 * Day Page (CANONICAL)
 * ======================================================
 *
 * This page:
 * - enforces progression rules
 * - resolves the daily practice via the canonical resolver
 * - renders the DayClient
 *
 * It does NOT:
 * - decide what today's practice is
 * - duplicate training camp logic
 * - generate prompts independently
 *
 * App and SMS now share the same source of truth.
 */

type PageProps = {
  params: Promise<{ day: string }>;
};

export default async function DayPage({ params }: PageProps) {
  const { day } = await params;
  const dayNumber = Number(day);

  if (!Number.isFinite(dayNumber) || dayNumber < 1) {
    redirect("/dashboard");
  }

  const { userId } = await auth();
  if (!userId) redirect("/dashboard");

  const user = await currentUser();
  if (!user) redirect("/dashboard");

  const currentDay =
    typeof user.publicMetadata?.currentDay === "number"
      ? user.publicMetadata.currentDay
      : 1;

  // 🔒 Prevent skipping ahead
  if (dayNumber > currentDay) {
    redirect("/dashboard");
  }

  // ----------------------------
  // CANONICAL DAILY PRACTICE
  // ----------------------------
  let practice;
  try {
    practice = await resolveDailyPracticeForUser(userId);
  } catch (err) {
    console.error("Day page resolver error:", err);
    redirect("/dashboard");
  }

  // If user manually navigates to a past day, allow read-only render
  if (practice.currentDay !== dayNumber) {
    // We still allow rendering, but we do NOT re-resolve content.
    // DayClient already enforces read-only behavior for past days.
  }

  // ----------------------------
  // Ephemeral Coach Pat note
  // ----------------------------
  const coachNote = await generateCoachPatNote({
    userId,
    dayNumber: practice.currentDay,
    actionItem: practice.actionItem,
  });

  const headerText =
    practice.phase === "Training Camp"
      ? `Training Camp — Day ${practice.currentDay}`
      : "Today’s Practice";

  return (
    <main className="max-w-2xl mx-auto py-16 px-6 space-y-8">
      <h1 className="text-3xl font-bold text-center">{headerText}</h1>

      <DayClient
        dayNumber={practice.currentDay}
        promptId={practice.promptId}
        coachNote={coachNote}
        actionItem={practice.actionItem}
        reflectionPrompt={practice.reflectionPrompt}
        video={practice.video}
      />
    </main>
  );
}

import type { ReactElement } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import OnboardingProgress from "@/components/onboarding-progress";
import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { resolveTrainingCampDay } from "@/lib/training-camp-resolver";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * Onboarding Complete Page (Pledge + Day 1 Preview)
 * ======================================================
 *
 * This is the final commitment moment.
 *
 * Rules:
 * - Preview Day 1 deterministically (Training Camp day 1)
 * - Do NOT require currentDay yet
 * - Do NOT allow completion without pledge
 */

export const dynamic = "force-dynamic";

export default async function CompletePage(): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  // Soft guard: if profile intake hasn't started, send them back to start.
  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select(
      "life_desires, ninety_day_vision, people_summary, responsibility, pressure_summary"
    )
    .eq("clerk_user_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/onboarding/identity");
  }

  const trainingCampTrack =
    md?.trainingCampTrack === "women" ? "women" : "standard";

  // Preview Day 1 practice WITHOUT needing metadata.currentDay
  let practice: { actionItem: string; reflectionPrompt: string } | null = null;

  try {
    const day1 = await resolveTrainingCampDay({
      dayNumber: 1,
      trainingCampTrack,
    });

    practice = {
      actionItem: day1.action_item,
      reflectionPrompt: day1.reflection_prompt,
    };
  } catch (err) {
    console.error("Onboarding complete Day 1 preview error:", err);
    practice = null;
  }

  return (
    <div className="space-y-10 text-center">
      <OnboardingProgress currentStep={7} />

      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Training Camp Ready
        </p>

        <h1 className="text-4xl font-bold">Your climb begins today.</h1>

        <p className="text-gray-600 text-lg leading-relaxed">
          One day at a time. One standard at a time.
        </p>
      </header>

      {/* Optional: a tiny “what you shared” recap for emotional payoff */}
      <section className="border rounded-xl bg-gray-50 p-6 text-left space-y-4">
        <p className="font-semibold text-gray-900">What Coach Pat now knows:</p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          {profile.life_desires ? (
            <li>
              <strong>What you want:</strong> {profile.life_desires}
            </li>
          ) : null}

          {profile.people_summary ? (
            <li>
              <strong>Who you show up for:</strong> {profile.people_summary}
            </li>
          ) : null}

          {profile.responsibility ? (
            <li>
              <strong>What you’re carrying:</strong> {profile.responsibility}
            </li>
          ) : null}
        </ul>

        <p className="text-xs text-gray-500 italic">
          Short answers are enough. Coach Pat will coach the real you.
        </p>
      </section>

      {practice && (
        <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              Day 1 Practice Preview
            </p>

            <p className="text-lg font-semibold text-gray-900">Today’s Practice</p>

            <p className="text-gray-700 mt-2 whitespace-pre-line">
              {practice.actionItem}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Reflection</p>

            <p className="text-gray-600 whitespace-pre-line">
              {practice.reflectionPrompt}
            </p>
          </div>

          <p className="text-xs text-gray-500 italic">
            Just one honest sentence. That’s the whole system.
          </p>
        </section>
      )}

      <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-4">
        <p className="font-semibold text-gray-900">Before you start:</p>
        <p className="text-sm text-gray-600">
          This isn’t a course. It’s training. Your only job is to show up today.
        </p>

        <CompleteOnboardingButton />
      </section>

      <p className="text-xs text-gray-500">
        Coach Pat will guide you one day at a time.
      </p>
    </div>
  );
}
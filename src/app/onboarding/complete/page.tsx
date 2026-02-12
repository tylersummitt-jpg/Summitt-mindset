import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { resolveTrainingCampDay } from "@/lib/training-camp-resolver";

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

export default async function CompletePage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  if (md?.onboardingCompleted === true) {
    redirect("/post-sign-in");
  }

  // We require onboardingOutcome to exist by now.
  const arena =
    typeof md?.onboardingArena === "string" ? md.onboardingArena : null;

  const outcome =
    typeof md?.onboardingOutcome === "string" ? md.onboardingOutcome : null;

  if (!arena || !outcome) {
    redirect("/onboarding");
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
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Training Camp Ready
        </p>

        <h1 className="text-4xl font-bold">Your climb begins today.</h1>

        <p className="text-gray-600 text-lg leading-relaxed">
          You chose where Coach Pat will focus first:
          <br />
          <span className="font-semibold text-gray-900">{arena}</span>
        </p>

        <p className="text-gray-600 text-lg leading-relaxed">
          And what “stronger” looks like in 30 days:
          <br />
          <span className="font-semibold text-gray-900">{outcome}</span>
        </p>
      </header>

      {practice && (
        <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              Day 1 Practice Preview
            </p>

            <p className="text-lg font-semibold text-gray-900">
              Today’s Practice
            </p>

            <p className="text-gray-700 mt-2 whitespace-pre-line">
              {practice.actionItem}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Reflection
            </p>

            <p className="text-gray-600 whitespace-pre-line">
              {practice.reflectionPrompt}
            </p>
          </div>

          <p className="text-xs text-gray-500 italic">
            Just one honest sentence. That’s the whole system.
          </p>
        </section>
      )}

      <section className="border rounded-xl bg-gray-50 p-6 text-left space-y-3">
        <p className="font-semibold text-gray-900">
          Here’s how Summitt Mindset works:
        </p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>One daily practice (3–7 minutes).</li>
          <li>One honest reflection.</li>
          <li>No catching up. No backlog. Just today.</li>
          <li>Momentum compounds quietly.</li>
        </ul>
      </section>

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

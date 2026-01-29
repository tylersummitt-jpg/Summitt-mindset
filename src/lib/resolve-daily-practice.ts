import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";

export default async function CompletePage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const metadata = user.publicMetadata as any;

  const goal =
    typeof metadata?.summittGoal === "string"
      ? metadata.summittGoal
      : "your next summit";

  // ✅ Resolve today's actual practice (Day 1)
  let practice;
  try {
    practice = await resolveDailyPracticeForUser(user.id);
  } catch (err) {
    console.error("Onboarding complete preview error:", err);
    practice = null;
  }

  return (
    <div className="space-y-10 text-center">
      {/* ✅ Identity Moment */}
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Training Camp Ready
        </p>

        <h1 className="text-4xl font-bold">
          Your climb begins today.
        </h1>

        <p className="text-gray-600 text-lg leading-relaxed">
          You’ve set your focus. You’ve chosen what to train.
          <br />
          Now we build consistency toward{" "}
          <span className="font-semibold text-gray-900">{goal}</span>.
        </p>
      </header>

      {/* ✅ Preview Today’s Practice */}
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

      {/* ✅ System Reminder */}
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

      {/* ✅ Start Button */}
      <div>
        <CompleteOnboardingButton />
      </div>

      {/* ✅ Coach reassurance */}
      <p className="text-xs text-gray-500">
        Coach Pat will guide you one day at a time.
      </p>
    </div>
  );
}

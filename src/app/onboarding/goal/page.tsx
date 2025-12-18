import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import SelectGoalButton from "@/components/SelectGoalButton";

export default async function GoalPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You must be signed in to continue.</p>
      </div>
    );
  }

  // IMPORTANT:
  // Onboarding should NEVER be gated by subscription.
  // Any signed-in user must be allowed to select a goal.

  const goals = [
    "Build confidence",
    "Improve communication",
    "Increase accountability",
    "Strengthen consistency",
    "Grow as a leader",
    "Reduce overwhelm / gain clarity",
  ];

  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">
        What’s your #1 goal right now?
      </h1>
      <p className="text-gray-600 mb-8">
        Your personalized path will be shaped around this.
      </p>

      <div className="space-y-4 mb-10">
        {goals.map((goal) => (
          <div
            key={goal}
            className="border rounded-lg p-4 bg-white shadow-sm flex items-center justify-between"
          >
            <p className="text-gray-800">{goal}</p>
            <SelectGoalButton goal={goal} />
          </div>
        ))}
      </div>

      <Link href="/onboarding" className="text-gray-500 underline text-sm">
        ← Back
      </Link>
    </div>
  );
}

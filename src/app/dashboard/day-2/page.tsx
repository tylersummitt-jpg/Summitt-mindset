import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DayCompleteButton from "../day-1/day-complete-button";

export default async function DayTwoPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const metadata = user.publicMetadata as any;

  const currentDay =
    typeof metadata?.currentDay === "number"
      ? metadata.currentDay
      : 1;

  // 🚫 Gate access — must have reached Day 2
  if (currentDay < 2) {
    redirect("/dashboard");
  }

  const goal =
    typeof metadata?.summittGoal === "string"
      ? metadata.summittGoal
      : "your growth";

  return (
    <main className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">
        Day 2: Build Awareness
      </h1>

      <p className="text-gray-600 mb-6">
        Today is about noticing patterns that affect {goal}.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <h2 className="font-semibold mb-2">Today’s Focus</h2>
        <p className="text-gray-700">
          Pay attention to one habit, thought, or behavior that helps or hurts
          your progress. Awareness always comes before change.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <h2 className="font-semibold mb-2">Reflection</h2>
        <p className="text-gray-600 text-sm mb-2">
          (Journaling will be saved later — for now, just reflect.)
        </p>

        <textarea
          className="w-full border rounded-md p-3 text-sm"
          rows={4}
          placeholder="What did you notice about yourself today?"
        />
      </div>

      <DayCompleteButton />

      <Link
        href="/dashboard"
        className="block text-center mt-4 text-blue-600 hover:underline text-sm"
      >
        Back to Dashboard
      </Link>
    </main>
  );
}

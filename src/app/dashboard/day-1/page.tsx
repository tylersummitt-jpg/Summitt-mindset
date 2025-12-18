import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DayCompleteButton from "./day-complete-button";

export default async function DayOnePage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const metadata = user.publicMetadata as any;

  const currentDay =
    typeof metadata?.currentDay === "number"
      ? metadata.currentDay
      : 1;

  if (currentDay < 1) {
    redirect("/dashboard");
  }

  const goal =
    typeof metadata?.summittGoal === "string"
      ? metadata.summittGoal
      : "your growth";

  return (
    <main className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">
        Day 1: Set Your Intention
      </h1>

      <p className="text-gray-600 mb-6">
        Today is about showing up. One small action to support {goal}.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <h2 className="font-semibold mb-2">Today’s Focus</h2>
        <p className="text-gray-700">
          Take two minutes and write down what you want to get out of
          Summitt Mindset over the next 30 days.
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
          placeholder="What does success look like for you in the next 30 days?"
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

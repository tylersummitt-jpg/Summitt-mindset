import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DayCompleteButton from "../day-1/day-complete-button";

export default async function DayFivePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const metadata = user.publicMetadata as any;
  const currentDay =
    typeof metadata?.currentDay === "number" ? metadata.currentDay : 1;

  if (currentDay < 5) redirect("/dashboard");

  const goal =
    typeof metadata?.summittGoal === "string"
      ? metadata.summittGoal
      : "your growth";

  return (
    <main className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">Day 5: Reflect and Adjust</h1>

      <p className="text-gray-600 mb-6">
        Reflection helps you recalibrate your approach to {goal}.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <h2 className="font-semibold mb-2">Today’s Focus</h2>
        <p className="text-gray-700">
          Look back on the last few days. What’s working? What needs a small
          adjustment?
        </p>
      </div>

      <textarea
        className="w-full border rounded-md p-3 text-sm mb-8"
        rows={4}
        placeholder="What would you adjust going forward?"
      />

      <DayCompleteButton />

      <Link href="/dashboard" className="block text-center mt-4 text-blue-600">
        Back to Dashboard
      </Link>
    </main>
  );
}

import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DayCompleteButton from "../day-1/day-complete-button";

export default async function DaySixPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const metadata = user.publicMetadata as any;
  const currentDay =
    typeof metadata?.currentDay === "number" ? metadata.currentDay : 1;

  if (currentDay < 6) redirect("/dashboard");

  const goal =
    typeof metadata?.summittGoal === "string"
      ? metadata.summittGoal
      : "your growth";

  return (
    <main className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">Day 6: Commit to the Process</h1>

      <p className="text-gray-600 mb-6">
        Progress toward {goal} comes from trusting the process, not forcing
        results.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <p className="text-gray-700">
          Today, recommit to showing up — even when progress feels slow.
        </p>
      </div>

      <textarea
        className="w-full border rounded-md p-3 text-sm mb-8"
        rows={4}
        placeholder="What does committing to the process look like for you?"
      />

      <DayCompleteButton />

      <Link href="/dashboard" className="block text-center mt-4 text-blue-600">
        Back to Dashboard
      </Link>
    </main>
  );
}

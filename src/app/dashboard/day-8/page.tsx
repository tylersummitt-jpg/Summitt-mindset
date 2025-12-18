import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DayCompleteButton from "../day-1/day-complete-button";

export default async function DayEightPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const metadata = user.publicMetadata as any;
  const currentDay =
    typeof metadata?.currentDay === "number" ? metadata.currentDay : 1;

  if (currentDay < 8) redirect("/dashboard");

  return (
    <main className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">Day 8: Raise the Standard</h1>

      <p className="text-gray-600 mb-6">
        Growth happens when you expect more from yourself — consistently.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm mb-8">
        <p className="text-gray-700">
          Choose one small standard you will raise moving forward.
        </p>
      </div>

      <textarea
        className="w-full border rounded-md p-3 text-sm mb-8"
        rows={4}
        placeholder="What standard will you raise?"
      />

      <DayCompleteButton />

      <Link href="/dashboard" className="block text-center mt-4 text-blue-600">
        Back to Dashboard
      </Link>
    </main>
  );
}

import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import SavePreferencesButton from "@/components/SavePreferencesButton";

export default async function PreferencesPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You must be signed in to continue.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">Your Coaching Preferences</h1>
      <p className="text-gray-600 mb-8">
        This helps us deliver the right nudge at the right time each day.
      </p>

      <div className="border rounded-lg p-6 bg-white shadow-sm space-y-6 mb-8">
        <p className="text-gray-700">
          SMS and email preferences will be added here soon.
        </p>

        <p className="text-sm text-gray-500">
          In the full system, you’ll choose your ideal SMS time, email
          preferences, and timezone for personalized daily coaching.
        </p>
      </div>

      <SavePreferencesButton />

      <div className="mt-6">
        <Link href="/onboarding/training-focus" className="text-sm underline text-gray-500">
          ← Back
        </Link>
      </div>
    </div>
  );
}

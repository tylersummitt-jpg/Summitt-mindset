import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function OnboardingPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You must be signed in to continue.</p>
      </div>
    );
  }

  const subscribed = user.publicMetadata?.summittSubscribed === true;

  if (!subscribed) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You need an active membership to begin onboarding.</p>
      </div>
    );
  }

  // Later: if user has already completed onboarding, redirect to dashboard.
  // For now, we always show the onboarding welcome screen.

  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-4">Welcome to Training Camp</h1>
      <p className="text-gray-600 mb-8">
        This 3-minute setup will customize your Summitt Mindset experience,
        set your primary goal, and prepare your personalized 30-Day Path.
      </p>

      <div className="border rounded-lg p-6 shadow-sm bg-white mb-10">
        <h2 className="text-xl font-semibold mb-3">What to expect:</h2>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Pick your primary focus for the next 30 days.</li>
          <li>Set your SMS / email coaching preferences.</li>
          <li>View your personalized 30-Day Game Plan.</li>
        </ul>
      </div>

      <Link
        href="/onboarding/goal"
        className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md text-lg"
      >
        Start Training Camp →
      </Link>
    </div>
  );
}

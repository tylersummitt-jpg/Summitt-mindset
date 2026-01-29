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

  return (
    <div className="text-center space-y-10">
      {/* ✅ Summit Ethos */}
      <header className="space-y-4">
        <h1 className="text-4xl font-bold">
          You’re in the right place.
        </h1>

        <p className="text-lg text-gray-600 leading-relaxed">
          Summitt Mindset is a calm daily system for people who want to climb
          toward something meaningful.
        </p>

        <p className="text-gray-600">
          No overwhelm. No pressure. Just one step today.
        </p>
      </header>

      {/* ✅ What This Is */}
      <section className="border rounded-xl bg-white shadow-sm p-6 text-left space-y-4">
        <p className="font-semibold text-gray-900">
          Here’s how it works:
        </p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>One daily practice (3–7 minutes).</li>
          <li>One honest reflection.</li>
          <li>Coach Pat guides you quietly.</li>
          <li>Momentum builds naturally.</li>
        </ul>
      </section>

      {/* ✅ CTA */}
      <Link
        href="/onboarding/goal"
        className="inline-block bg-black text-white px-8 py-4 rounded-md font-semibold text-lg hover:bg-gray-900"
      >
        Start Your Training Camp →
      </Link>

      <p className="text-xs text-gray-500">
        This takes less than 3 minutes.
      </p>
    </div>
  );
}

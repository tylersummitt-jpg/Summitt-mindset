// src/app/subscribe/page.tsx
import Link from "next/link";

export default function SubscribePage() {
  return (
    <main className="bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-4">Join the Summitt Membership</h1>
        <p className="text-gray-700 mb-6">
          One simple subscription gives you full access to the Summitt Assessment
          results, Ask Pat AI, and the growing Pat Summitt leadership library.
        </p>

        <div className="bg-white border rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-2">$25/month</h2>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mb-4">
            <li>Full Summitt Assessment breakdown (all 12 principles)</li>
            <li>Ask Pat AI access</li>
            <li>All current and future learning modules</li>
            <li>Progress tracking over time</li>
          </ul>
          <button className="px-6 py-3 border rounded text-sm font-semibold">
            Continue to Checkout (Stripe later)
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Already a member?{" "}
          <Link href="/dashboard" className="underline">
            Go to your dashboard.
          </Link>
        </p>
      </div>
    </main>
  );
}

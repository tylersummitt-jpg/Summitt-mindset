// src/app/summitt-assessment/page.tsx
import Link from "next/link";

export default function SummittAssessmentLandingPage() {
  return (
    <main className="bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-4">The Summitt Assessment</h1>
        <p className="text-gray-700 mb-4">
          36 questions across Pat Summitt&apos;s Definite Dozen principles. Get
          a clear picture of your mindset, habits, and leadership.
        </p>
        <p className="text-gray-700 mb-6 text-sm">
          You&apos;ll rate statements on a 1–5 scale. At the end you&apos;ll see
          your Summitt Score and your key strengths and growth opportunities.
        </p>
        <Link
          href="#"
          className="inline-block px-6 py-3 border rounded text-sm font-semibold"
        >
          Begin (questions coming soon)
        </Link>
      </div>
    </main>
  );
}

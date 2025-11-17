// src/app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="bg-gray-50">
      <section className="max-w-6xl mx-auto px-4 py-16 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Bring Pat Summitt’s standards into your everyday life.
          </h1>
          <p className="text-gray-700 mb-6">
            The Summitt Assessment, Ask Pat AI, and a growing content library
            built on the Definite Dozen principles—designed to sharpen your
            mindset, habits, and leadership.
          </p>
          <div className="flex gap-3">
            <Link
              href="/summitt-assessment"
              className="px-6 py-3 border rounded text-sm font-semibold"
            >
              Take the Summitt Assessment
            </Link>
            <Link
              href="/subscribe"
              className="px-6 py-3 border rounded text-sm font-semibold"
            >
              Join the Membership
            </Link>
          </div>
        </div>
        <div className="bg-white border rounded-lg shadow p-6 text-sm space-y-3">
          <h2 className="font-semibold mb-2">What you get</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Summitt Assessment: 36 questions across the Definite Dozen</li>
            <li>Ask Pat AI: coaching modeled on Pat’s principles</li>
            <li>Content Library: videos, lessons, and tools</li>
            <li>Weekly Pat Challenges linked to your profile</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

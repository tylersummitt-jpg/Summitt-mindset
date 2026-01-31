// src/app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="bg-gray-50">
      <section className="max-w-6xl mx-auto px-4 py-20 grid md:grid-cols-2 gap-12 items-center">
        {/* LEFT — Core Pitch */}
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-5">
            A calm daily practice system inspired by Coach Pat Summitt.
          </h1>

          <p className="text-gray-700 text-lg mb-8 leading-relaxed">
            Summitt Mindset is not a course.  
            It’s not a content library.  
            It’s a simple daily rhythm:
            <br />
            <strong>Practice → Reflection → Consistency.</strong>
          </p>

          <div className="flex gap-3">
            <Link
              href="/subscribe"
              className="px-6 py-3 bg-black text-white rounded-md text-sm font-semibold hover:bg-gray-900"
            >
              Start Your 7-Day Trial →
            </Link>

            <Link
              href="/dashboard"
              className="px-6 py-3 border rounded-md text-sm font-semibold hover:bg-white"
            >
              Enter the Daily Practice
            </Link>
          </div>
        </div>

        {/* RIGHT — What You Get */}
        <div className="bg-white border rounded-xl shadow-sm p-8 space-y-4">
          <h2 className="text-lg font-semibold mb-2">
            What Summitt Mindset gives you
          </h2>

          <ul className="list-disc list-inside text-gray-700 space-y-2 text-sm">
            <li>One daily practice (3–7 minutes)</li>
            <li>One honest reflection to complete the day</li>
            <li>Coach Pat’s calm guidance every day</li>
            <li>Optional film study in the Film Room</li>
            <li>Daily SMS support for members who prefer text</li>
          </ul>

          <p className="text-xs text-gray-500 pt-2">
            No catching up. No backlog. Just today.
          </p>
        </div>
      </section>
    </main>
  );
}

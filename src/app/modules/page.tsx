// src/app/modules/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function ModulesPage() {
  const user = await currentUser();
  const isMember = user?.publicMetadata?.summittSubscribed === true;

  // ================================
  // MEMBER VIEW
  // ================================
  if (isMember) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-3">Summitt Leadership Library</h1>
        <p className="text-gray-700 mb-6">
          Your membership gives you access to every Summitt Leadership module.
          New lessons will appear here as the library expands.
        </p>

        <div className="border rounded-lg p-5 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-2">Library Modules</h2>
          <p className="text-gray-700 text-sm mb-4">
            Modules aren’t live yet — but here is where all 12 Definite Dozen
            tracks will show up once built.
          </p>

          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            <li>Discipline Basics</li>
            <li>Put the Team Before Yourself</li>
            <li>More tracks coming soon…</li>
          </ul>
        </div>
      </main>
    );
  }

  // ================================
  // NON-MEMBER MARKETING VIEW
  // ================================
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      {/* Your full original marketing text */}
      {/* (keep everything you already had here) */}

      <section className="border rounded-lg p-5 bg-gray-50 text-sm text-gray-900">
        <p className="font-semibold mb-2">
          Ready to unlock the full Summitt Leadership Library?
        </p>
        <p className="mb-3">
          The library is part of the{" "}
          <span className="font-semibold">Summitt Membership</span>.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-gray-700">
            $25/month. Cancel anytime.
          </p>
          <Link
            href="/subscribe"
            className="inline-flex justify-center rounded-md bg-black px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition"
          >
            Join the Membership
          </Link>
        </div>
      </section>
    </main>
  );
}

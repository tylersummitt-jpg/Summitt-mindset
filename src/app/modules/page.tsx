// src/app/modules/page.tsx
import Link from "next/link";

const mockModules = [
  {
    id: "discipline-basics",
    title: "Discipline Basics",
    description: "Build routines so no one else has to.",
  },
  {
    id: "team-before-self",
    title: "Put the Team Before Yourself",
    description: "Shift from me-first to team-first.",
  },
];

export default function ModulesPage() {
  return (
    <main className="bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-4">Summitt Library</h1>
        <p className="text-gray-700 text-sm mb-6">
          This will grow into a full library of lessons, videos, and tools
          aligned to the Definite Dozen.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {mockModules.map((m) => (
            <Link
              key={m.id}
              href={`/modules/${m.id}`}
              className="bg-white border rounded p-4 hover:border-gray-900 transition text-sm"
            >
              <h2 className="font-semibold mb-1">{m.title}</h2>
              <p className="text-gray-700 text-xs">{m.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

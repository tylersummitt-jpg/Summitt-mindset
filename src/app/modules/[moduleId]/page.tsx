// src/app/modules/[moduleId]/page.tsx
import { notFound } from "next/navigation";

const MOCK_MODULES: Record<string, { title: string; description: string }> = {
  "discipline-basics": {
    title: "Discipline Basics",
    description: "Placeholder module on discipline.",
  },
  "team-before-self": {
    title: "Put the Team Before Yourself",
    description: "Placeholder module on team-first mindset.",
  },
};

export default function ModuleDetailPage({
  params,
}: {
  params: { moduleId: string };
}) {
  const moduleData = MOCK_MODULES[params.moduleId];

  if (!moduleData) {
    notFound();
  }

  return (
    <main className="bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <h1 className="text-3xl font-bold">{moduleData.title}</h1>
        <p className="text-gray-700 text-sm">{moduleData.description}</p>
        <div className="bg-white border rounded p-4 text-sm text-gray-600">
          <p className="font-semibold mb-2">Module content placeholder</p>
          <p>
            Later we&apos;ll plug in real videos, lesson text, downloads, and
            links to your Summitt Assessment results here.
          </p>
        </div>
      </div>
    </main>
  );
}

import { currentUser } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";

const MOCK_MODULES: Record<
  string,
  { title: string; description: string }
> = {
  "discipline-basics": {
    title: "Discipline Basics",
    description: "Placeholder module on discipline.",
  },
  "team-before-self": {
    title: "Put the Team Before Yourself",
    description: "Placeholder module on team-first mindset.",
  },
};

type ModuleDetailPageProps = {
  params: {
    moduleId: string;
  };
};

export default async function ModuleDetailPage({
  params,
}: ModuleDetailPageProps) {
  const user = await currentUser();

  // If not logged in, send them to sign-in (or subscribe) first
  if (!user) {
    redirect("/sign-in?redirect_url=/modules");
  }

  const subscribed = user.publicMetadata?.summittSubscribed === true;

  if (!subscribed) {
    redirect("/subscribe");
  }

  const moduleData = MOCK_MODULES[params.moduleId];
  if (!moduleData) notFound();

  return (
    <main className="bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <h1 className="text-3xl font-bold">{moduleData.title}</h1>
        <p className="text-gray-700 text-sm">{moduleData.description}</p>

        <div className="bg-white border rounded p-4 text-sm text-gray-600">
          <p className="font-semibold mb-2">Module Content Placeholder</p>
          <p>
            Real videos, lessons, exercises, and downloads will appear here once
            the LMS is live.
          </p>
        </div>
      </div>
    </main>
  );
}

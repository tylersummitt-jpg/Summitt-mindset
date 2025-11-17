// src/app/dashboard/page.tsx
import Link from "next/link";

export default function DashboardPage() {
  const tools = [
    {
      title: "Summitt Assessment",
      href: "/summitt-assessment",
      description:
        "View or retake your assessment and track your progress across the Definite Dozen.",
      cta: "Go to Summitt Assessment",
    },
    {
      title: "Ask Pat AI",
      href: "/ask-pat",
      description:
        "Ask Pat-style questions and get coaching tied to your profile.",
      cta: "Open Ask Pat AI",
    },
    {
      title: "Content Library",
      href: "/modules",
      description:
        "Dive into video lessons, worksheets, and modules aligned to the Definite Dozen.",
      cta: "Browse modules",
    },
    {
      title: "Subscription & Billing",
      href: "/subscribe",
      description:
        "Manage your subscription, billing details, and membership status.",
      cta: "Manage subscription",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
        <header>
          <h1 className="text-3xl font-bold mb-2">Your Dashboard</h1>
          <p className="text-gray-700 text-sm">
            This is where subscribers will see their latest Summitt Score, recent
            Pat Challenges, and recommended modules.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group block h-full"
            >
              <div className="h-full bg-white border rounded-xl p-4 md:p-5 shadow-sm hover:shadow-md transition cursor-pointer">
                <h2 className="font-semibold text-sm mb-2">{tool.title}</h2>
                <p className="text-xs text-gray-700 mb-3">
                  {tool.description}
                </p>
                <span className="text-xs underline group-hover:no-underline">
                  {tool.cta}
                </span>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

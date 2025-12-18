import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

type PathDay = {
  day: number;
  title: string;
  description: string;
};

function generate30DayPath(goal: string): PathDay[] {
  const base = [
    "Set your intention",
    "Build awareness",
    "Practice consistency",
    "Strengthen discipline",
    "Reflect and adjust",
  ];

  return Array.from({ length: 30 }).map((_, i) => {
    const day = i + 1;
    const theme = base[i % base.length];

    return {
      day,
      title: `Day ${day}: ${theme}`,
      description: `A focused action designed to improve your ${goal}.`,
    };
  });
}

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You must be signed in to access your dashboard.</p>
      </div>
    );
  }

  const publicMetadata = user.publicMetadata as any;

  const subscribed = publicMetadata?.summittSubscribed === true;
  const plan =
    typeof publicMetadata?.summittPlan === "string"
      ? publicMetadata.summittPlan
      : "N/A";

  const onboardingCompleted = publicMetadata?.onboardingCompleted === true;
  const goal =
    typeof publicMetadata?.summittGoal === "string"
      ? publicMetadata.summittGoal
      : null;

  const currentDay =
    typeof publicMetadata?.currentDay === "number"
      ? publicMetadata.currentDay
      : 1;

  const totalDaysCompleted =
    typeof publicMetadata?.totalDaysCompleted === "number"
      ? publicMetadata.totalDaysCompleted
      : 0;

  const daysInRow =
    typeof publicMetadata?.daysInRow === "number"
      ? publicMetadata.daysInRow
      : 0;

  const path =
    onboardingCompleted && goal
      ? generate30DayPath(goal)
      : [];

  return (
    <main className="max-w-4xl mx-auto py-10 px-6">
      <h1 className="text-3xl font-bold mb-2">
        Welcome back, {user.firstName || "Member"}!
      </h1>
      <p className="text-gray-600 mb-6">
        Your Summitt Mindset journey continues.
      </p>

      {/* Progress Identity */}
      <section className="grid grid-cols-2 gap-4 mb-8">
        <div className="border rounded-lg p-5 bg-white shadow-sm text-center">
          <p className="text-3xl font-bold">{totalDaysCompleted}</p>
          <p className="text-gray-600 text-sm">Total Days Completed</p>
        </div>

        <div className="border rounded-lg p-5 bg-white shadow-sm text-center">
          <p className="text-3xl font-bold">{daysInRow}</p>
          <p className="text-gray-600 text-sm">
            Days in a Row {daysInRow >= 2 && "🔥"}
          </p>
        </div>
      </section>

      {/* Membership Status */}
      <section className="border rounded-lg p-5 mb-8 bg-white shadow-sm">
        <h2 className="text-xl font-semibold mb-2">Membership Status</h2>

        <p>
          <strong>Status:</strong>{" "}
          {subscribed ? "Active Member" : "Not Subscribed"}
        </p>

        <p>
          <strong>Plan:</strong> {plan}
        </p>

        {!subscribed && (
          <div className="mt-4">
            <Link
              href="/subscribe"
              className="inline-block border border-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-black hover:text-white transition"
            >
              Start Free Trial
            </Link>
          </div>
        )}
      </section>

      {/* 30-Day Path */}
      {onboardingCompleted && goal && (
        <section className="border rounded-lg p-5 mb-8 bg-white shadow-sm">
          <h2 className="text-2xl font-semibold mb-2">
            Your 30-Day Path
          </h2>
          <p className="text-gray-600 mb-6">
            Built around your goal:{" "}
            <span className="font-semibold text-blue-600">{goal}</span>
          </p>

          <div className="space-y-3">
            {path.map((day) => {
              const isPast = day.day < currentDay;
              const isCurrent = day.day === currentDay;

              const baseClasses =
                "border rounded-md p-4 transition";

              if (isPast) {
                return (
                  <div
                    key={day.day}
                    className={`${baseClasses} bg-gray-100 text-gray-500`}
                  >
                    <h3 className="font-semibold">
                      {day.title} ✓
                    </h3>
                    <p className="text-sm mt-1">Completed</p>
                  </div>
                );
              }

              if (isCurrent) {
                return (
                  <Link
                    key={day.day}
                    href={`/dashboard/day-${day.day}`}
                    className={`${baseClasses} block bg-blue-50 border-blue-400 hover:bg-blue-100`}
                  >
                    <h3 className="font-semibold">{day.title}</h3>
                    <p className="text-gray-600 text-sm mt-1">
                      {day.description}
                    </p>
                  </Link>
                );
              }

              return (
                <div
                  key={day.day}
                  className={`${baseClasses} bg-gray-50 text-gray-400`}
                >
                  <h3 className="font-semibold">
                    {day.title} 🔒
                  </h3>
                  <p className="text-sm mt-1">Unlocks later</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6">
            <Link
              href={`/dashboard/day-${currentDay}`}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-semibold"
            >
              Continue Day {currentDay} →
            </Link>
          </div>
        </section>
      )}

      {/* Ask Pat AI */}
      <section className="border rounded-lg p-5 mb-8 bg-white shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Ask Pat AI</h2>
        <p className="text-gray-600 mb-4">
          Ask Coach Pat anything. Leadership, mindset, or life.
        </p>

        <Link
          href="/ask-pat"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
        >
          Open Ask Pat
        </Link>
      </section>
    </main>
  );
}

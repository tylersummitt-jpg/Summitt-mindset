import { currentUser, auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

const MILESTONES = [35, 40, 50, 75, 100, 150, 200];

type PathDay = {
  day: number;
  title: string;
  description: string;
};

function safeString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function safeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/**
 * This is the NEW Training Camp identity anchor.
 * Outcome is the strongest. Arena is fallback.
 */
function buildTrainingToward({
  onboardingOutcome,
  onboardingArena,
}: {
  onboardingOutcome: string | null;
  onboardingArena: string | null;
}): { label: string; value: string } | null {
  if (onboardingOutcome) return { label: "Training toward", value: onboardingOutcome };
  if (onboardingArena) return { label: "Training in", value: onboardingArena };
  return null;
}

function generate30DayPath({
  focusLabel,
  focusValue,
}: {
  focusLabel: string;
  focusValue: string;
}): PathDay[] {
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
      description: `A focused action designed to support your ${focusLabel.toLowerCase()} — ${focusValue}.`,
    };
  });
}

function milestoneLabel(n: number) {
  if (n === 35) return "You’re building real momentum.";
  if (n === 40) return "You’re doing uncommon work.";
  if (n === 50) return "This is a standard now.";
  if (n === 75) return "Most people don’t reach this.";
  if (n === 100) return "That’s identity-level consistency.";
  if (n === 150) return "You’ve changed how you live.";
  if (n === 200) return "This is who you are now.";
  return "That kind of consistency compounds.";
}

export default async function DashboardPage() {
  const user = await currentUser();
  const { userId } = await auth();

  if (!user || !userId) return null;

  const metadata = (user.publicMetadata || {}) as Record<string, any>;

  const onboardingCompleted = metadata?.onboardingCompleted === true;

  const currentDay =
    typeof metadata?.currentDay === "number" && metadata.currentDay > 0
      ? metadata.currentDay
      : 1;

  const totalDaysCompleted =
    typeof metadata?.totalDaysCompleted === "number"
      ? metadata.totalDaysCompleted
      : 0;

  const inTrainingCamp = currentDay <= 30;

  // ======================================================
  // TIMEZONE-AWARE "COMPLETED TODAY" LOCK
  // ======================================================
  const timezone = resolveUserTimezone(metadata?.timezone);
  const now = new Date();
  const todayKey = getDateKeyInTimezone(now, timezone);

  let completedToday = false;

  if (typeof metadata?.lastCompletedAt === "string") {
    const last = new Date(metadata.lastCompletedAt);
    const lastKey = getDateKeyInTimezone(last, timezone);

    completedToday = lastKey === todayKey;
  }

  /**
   * If completed today:
   * - currentDay already advanced
   * - lock tomorrow until after midnight
   */
  const maxAccessibleDay = completedToday
    ? Math.max(currentDay - 1, 1)
    : currentDay;

  // ======================================================
  // NEW: Onboarding identity anchors
  // ======================================================
  const onboardingOutcome = safeString(metadata?.onboardingOutcome);
  const onboardingArena = safeString(metadata?.onboardingArena);
  const trainingThemes = safeStringArray(metadata?.trainingThemes);

  const trainingToward = buildTrainingToward({
    onboardingOutcome,
    onboardingArena,
  });

  // ===========================
  // TRAINING CAMP (Days 1–30)
  // ===========================
  if (inTrainingCamp) {
    if (!onboardingCompleted) {
      return (
        <main className="max-w-xl mx-auto py-16 px-6 text-center">
          <h1 className="text-3xl font-semibold mb-3">
            Finish Training Camp Setup
          </h1>
          <p className="text-gray-600 mb-8">
            Quick setup to personalize your 30-day path.
          </p>

          <Link
            href="/onboarding"
            className="inline-block bg-black text-white rounded-md px-6 py-3 font-semibold hover:bg-gray-900"
          >
            Continue Onboarding →
          </Link>
        </main>
      );
    }

    // If onboarding is complete but new fields are missing (older users),
    // we do NOT hard-block. We show a clean, calm fallback.
    const focusLabel = trainingToward?.label ?? "Practice";
    const focusValue =
      trainingToward?.value ?? "showing up with intention, one day at a time";

    const path = generate30DayPath({ focusLabel, focusValue });

    // 🔑 Fetch most recent weekly Coach Pat note (single paragraph only)
    const { data: latestWeekly } = await supabaseServer
      .from("weekly_summaries")
      .select("weekly_summary")
      .eq("clerk_user_id", userId) // ✅ CANONICAL
      .order("week_end_day", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (
      <main className="max-w-4xl mx-auto py-10 px-6">
        <h1 className="text-3xl font-bold mb-2">
          Training Camp — Day {maxAccessibleDay}
        </h1>

        <p className="text-gray-600 mb-8">
          Show up. Practice with intention. Reflect honestly.
        </p>

        {/* ======================================================
            NEW: Identity anchor card (calm, not loud)
           ====================================================== */}
        {trainingToward && (
          <section className="border rounded-lg p-6 mb-6 bg-white shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
              {trainingToward.label}
            </p>
            <p className="text-lg font-semibold text-gray-900">
              {trainingToward.value}
            </p>

            {trainingThemes.length > 0 && (
              <p className="text-sm text-gray-600 mt-3">
                Focus themes:{" "}
                <span className="text-gray-900 font-medium">
                  {trainingThemes.slice(0, 3).join(", ")}
                </span>
              </p>
            )}
          </section>
        )}

        {latestWeekly?.weekly_summary && (
          <section className="border rounded-lg p-6 mb-8 bg-white shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-3">
              A Note from Coach Pat
            </p>
            <p className="text-gray-900 leading-relaxed">
              {latestWeekly.weekly_summary}
            </p>
          </section>
        )}

        <section className="border rounded-lg p-6 mb-8 bg-white shadow-sm text-center">
          <p className="text-3xl font-bold">{totalDaysCompleted}</p>
          <p className="text-gray-600 text-sm">Total Days Practiced</p>
        </section>

        <section className="border rounded-lg p-5 mb-8 bg-white shadow-sm">
          <h2 className="text-2xl font-semibold mb-4">Your 30-Day Path</h2>

          <div className="space-y-3">
            {path.map((d) => {
              const isPast = d.day < maxAccessibleDay;
              const isCurrent = d.day === maxAccessibleDay;

              // Tomorrow is special: show "Tomorrow"
              const isTomorrow = d.day === maxAccessibleDay + 1;

              if (isPast) {
                return (
                  <div
                    key={d.day}
                    className="border rounded-md p-4 bg-gray-100 text-gray-500"
                  >
                    {d.title} ✓
                  </div>
                );
              }

              if (isCurrent) {
                return (
                  <Link
                    key={d.day}
                    href={`/dashboard/day/${d.day}`}
                    className="block border rounded-md p-4 bg-blue-50 hover:bg-blue-100"
                  >
                    {d.title}
                  </Link>
                );
              }

              if (isTomorrow) {
                return (
                  <div
                    key={d.day}
                    className="border rounded-md p-4 bg-gray-50 text-gray-500"
                  >
                    {d.title}{" "}
                    <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">
                      Tomorrow
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={d.day}
                  className="border rounded-md p-4 bg-gray-50 text-gray-400"
                >
                  {d.title} 🔒
                </div>
              );
            })}
          </div>

          <Link
            href={`/dashboard/day/${maxAccessibleDay}`}
            className="inline-block mt-6 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-semibold"
          >
            Continue Today’s Practice →
          </Link>
        </section>
      </main>
    );
  }

  // ===========================
  // IN-SEASON PRACTICE (Day 31+)
  // ===========================
  const lastMilestone = MILESTONES.filter((m) => m <= totalDaysCompleted).at(-1);
  const justHitMilestone =
    lastMilestone !== undefined && lastMilestone === totalDaysCompleted;

  return (
    <main className="max-w-xl mx-auto py-16 px-6 text-center">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
        In-Season Practice
      </p>

      <h1 className="text-3xl font-semibold mb-3">Today’s Practice</h1>

      <p className="text-gray-600 mb-8">
        No catching up. No backlog. Just today.
      </p>

      <Link
        href={`/dashboard/day/${maxAccessibleDay}`}
        className="block bg-black text-white rounded-md py-4 font-semibold mb-10 hover:bg-gray-900"
      >
        Continue Today’s Practice
      </Link>

      {justHitMilestone && lastMilestone !== undefined && (
        <section className="border-l-4 border-green-600 bg-green-50 rounded-lg p-6 mb-8 shadow-sm text-left">
          <h2 className="text-lg font-semibold mb-2">Milestone Reached</h2>
          <p className="text-gray-800">
            You’ve completed <strong>{lastMilestone}</strong> days of practice.{" "}
            {milestoneLabel(lastMilestone)}
          </p>
        </section>
      )}
    </main>
  );
}

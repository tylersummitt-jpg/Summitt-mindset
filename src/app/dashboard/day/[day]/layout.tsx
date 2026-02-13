import { ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

function safeDayNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

function isSubscribedFromMetadata(md: Record<string, any>) {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;

  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

/**
 * ======================================================
 * Day Route Gate (CANONICAL)
 * ======================================================
 *
 * Rules:
 * - Must be signed in
 * - Must be subscribed
 * - Must be onboarded
 * - If completed today, tomorrow stays locked until midnight (timezone-aware)
 */
export default async function DayLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ day: string }>;
}) {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, any>;

  // 🔒 Must be subscribed
  if (!isSubscribedFromMetadata(md)) {
    redirect("/subscribe");
  }

  // 🔒 Must be onboarded
  if (md?.onboardingCompleted !== true) {
    redirect("/onboarding");
  }

  const currentDay = safeDayNumber(md.currentDay);
  if (!currentDay) {
    redirect("/onboarding");
  }

  // ✅ MUST AWAIT PARAMS IN NEXT 15+
  const resolvedParams = await params;

  const requestedDay = safeDayNumber(resolvedParams.day);
  if (!requestedDay) {
    redirect(`/dashboard/day/${currentDay}`);
  }

  // ----------------------------
  // TIMEZONE-AWARE LOCK LOGIC
  // ----------------------------
  const timezone = resolveUserTimezone(md.timezone);
  const now = new Date();
  const todayKey = getDateKeyInTimezone(now, timezone);

  let completedToday = false;

  if (typeof md.lastCompletedAt === "string") {
    const last = new Date(md.lastCompletedAt);
    const lastKey = getDateKeyInTimezone(last, timezone);

    completedToday = lastKey === todayKey;
  }

  /**
   * If completed today:
   * - currentDay already advanced
   * - lock access until tomorrow
   */
  const maxAccessibleDay = completedToday
    ? Math.max(currentDay - 1, 1)
    : currentDay;

  // ✅ Block tomorrow early
  if (requestedDay > maxAccessibleDay) {
    redirect(`/dashboard/day/${maxAccessibleDay}`);
  }

  return <>{children}</>;
}

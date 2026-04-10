/**
 * Shadow-mode weekly SMS reflections: generates template copy + metadata for
 * `weekly_sms_reflections` without sending SMS or touching delivery state.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { getWeekKey } from "@/lib/weekly-sms-week-key";

export type MemoryBucket = "rich" | "partial" | "sparse" | "profile_only";

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = nd.getUTCFullYear();
  const mm = String(nd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Monday = 0 … Sunday = 6 (ISO-style week starting Monday). */
function weekdayMon0Sun6InTimezone(date: Date, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const key = short.slice(0, 3);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[key] ?? 0;
}

function classifyMemoryBucket(completionCount: number): MemoryBucket {
  if (completionCount >= 5) return "rich";
  if (completionCount >= 3) return "partial";
  if (completionCount >= 1) return "sparse";
  return "profile_only";
}

function buildShadowSmsBody(
  bucket: MemoryBucket,
  completionCount: number,
  preferredName: string | null
): string {
  const prefix = preferredName ? `${preferredName}, ` : "";
  switch (bucket) {
    case "rich":
      return `${prefix}this week you completed ${completionCount} days — real momentum.`;
    case "partial":
      return `${prefix}you showed up ${completionCount} days this week. Consistency adds up.`;
    case "sparse":
      return `${prefix}${completionCount} day${
        completionCount === 1 ? "" : "s"
      } completed this week. Small steps still count.`;
    case "profile_only":
    default:
      return `${prefix}a quieter week on completions. Next week is a fresh start.`;
  }
}

/**
 * Computes shadow weekly reflection row (upsert). Does not send SMS.
 * Idempotent on (clerk_user_id, week_key).
 *
 * @param localNow — same "local" Date used by weekly-sms cron (recommended).
 */
export async function generateWeeklySmsReflection(
  clerkUserId: string,
  timezone: string,
  localNow?: Date
): Promise<void> {
  try {
    const tz = resolveUserTimezone(timezone);
    const now = new Date();
    const local =
      localNow ??
      new Date(now.toLocaleString("en-US", { timeZone: tz }));

    const weekKey = getWeekKey(local);

    const todayKey = getDateKeyInTimezone(local, tz);
    const dow = weekdayMon0Sun6InTimezone(local, tz);
    const weekStartKey = addCalendarDays(todayKey, -dow);
    const weekEndKey = addCalendarDays(weekStartKey, 6);

    const { count: completionCount, error: countErr } = await supabaseServer
      .from("daily_completion_events")
      .select("*", { count: "exact", head: true })
      .eq("clerk_user_id", clerkUserId)
      .gte("day_key", weekStartKey)
      .lte("day_key", weekEndKey);

    if (countErr) {
      console.error("[weekly-sms-reflection-shadow] completion count failed", {
        clerkUserId,
        error: countErr.message,
      });
      return;
    }

    const c = completionCount ?? 0;
    const memoryBucket = classifyMemoryBucket(c);

    const [{ data: profile }, { data: summary }] = await Promise.all([
      supabaseServer
        .from("user_profiles")
        .select("preferred_name")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle(),
      supabaseServer
        .from("weekly_summaries")
        .select("weekly_summary, created_at")
        .eq("clerk_user_id", clerkUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const preferredName =
      typeof profile?.preferred_name === "string" &&
      profile.preferred_name.trim()
        ? profile.preferred_name.trim()
        : null;

    const smsBody = buildShadowSmsBody(memoryBucket, c, preferredName);

    const inputsSummary = {
      timezone: tz,
      week_key: weekKey,
      week_start_date: weekStartKey,
      week_end_date: weekEndKey,
      completion_count: c,
      memory_bucket: memoryBucket,
      has_weekly_summary: Boolean(
        summary?.weekly_summary &&
          String(summary.weekly_summary).trim().length > 0
      ),
      weekly_summary_preview:
        summary?.weekly_summary &&
        String(summary.weekly_summary).trim().slice(0, 200),
    };

    const { error: upsertErr } = await supabaseServer
      .from("weekly_sms_reflections")
      .upsert(
        {
          clerk_user_id: clerkUserId,
          week_key: weekKey,
          week_start_date: weekStartKey,
          memory_bucket: memoryBucket,
          sms_body: smsBody,
          inputs_summary: inputsSummary,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id,week_key" }
      );

    if (upsertErr) {
      console.error("[weekly-sms-reflection-shadow] upsert failed", {
        clerkUserId,
        weekKey,
        error: upsertErr.message,
      });
    }
  } catch (e) {
    console.error("[weekly-sms-reflection-shadow] unexpected", {
      clerkUserId,
      error: String(e),
    });
  }
}

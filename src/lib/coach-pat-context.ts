import { supabaseServer } from "@/lib/supabase-server";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * CoachPatContext (LOCKED SHAPE)
 */

export type StalenessMode = "fresh" | "normal" | "reentry";

export type CoachPatContext = {
  identity: {
    preferred_name?: string;
    primary_goal?: string;
    coach_tone?: string;
    spouse_name?: string;
    kids_summary?: string;
    values?: string[];
  };
  patterns: string[];
  recent_summary: {
    available: boolean;
    summary_text?: string;
  };
  today_context: {
    day_number: number;
    phase: "Training Camp" | "In-Season";
    staleness_mode: StalenessMode;
    days_since_last_completion: number | null;
  };
  today_practice: {
    practice_summary: string;
  };
};

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function phaseFromDay(dayNumber: number): "Training Camp" | "In-Season" {
  return dayNumber <= 30 ? "Training Camp" : "In-Season";
}

function computeStalenessMode(daysSince: number | null): StalenessMode {
  if (daysSince === null) return "normal";
  if (daysSince <= 1) return "fresh";
  if (daysSince <= 3) return "normal";
  return "reentry";
}

function summarizePractice(actionItem: string): string {
  const cleaned = normalizeText(actionItem);
  return cleaned
    ? "A focused daily practice followed by honest reflection."
    : "A simple daily practice followed by honest reflection.";
}

async function getDaysSinceLastCompletion(userId: string): Promise<number | null> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("updated_at, created_at")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const stampRaw = (data as any).updated_at || (data as any).created_at;
  if (!stampRaw) return null;

  const diffMs = Date.now() - new Date(stampRaw).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

async function getLatestWeeklySummary(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("weekly_summaries")
    .select("weekly_summary")
    .eq("clerk_user_id", userId)
    .order("week_end_day", { ascending: false })
    .limit(1)
    .maybeSingle();

  const txt = normalizeText(data?.weekly_summary ?? "");
  return txt || null;
}

async function getLatestDailySummary(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const txt = normalizeText(data?.daily_summaries ?? "");
  return txt || null;
}

export async function buildCoachPatContext({
  userId,
  dayNumber,
  actionItem,
}: {
  userId: string;
  dayNumber: number;
  actionItem: string;
}): Promise<CoachPatContext> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const preferred_name = user.firstName ?? undefined;
  const primary_goal =
    typeof user.publicMetadata?.summittGoal === "string"
      ? user.publicMetadata.summittGoal
      : undefined;

  const phase = phaseFromDay(dayNumber);
  const daysSinceLastCompletion = await getDaysSinceLastCompletion(userId);
  const staleness_mode = computeStalenessMode(daysSinceLastCompletion);

  const weekly = await getLatestWeeklySummary(userId);
  const latestDaily = await getLatestDailySummary(userId);

  let recent_summary_available = true;
  let recent_summary_text: string | undefined;

  if (staleness_mode === "reentry") {
    recent_summary_available = false;
  } else if (weekly) {
    recent_summary_text = weekly;
  } else if (latestDaily) {
    recent_summary_text = latestDaily;
  } else {
    recent_summary_available = false;
  }

  return {
    identity: {
      preferred_name,
      primary_goal,
      coach_tone: "calm, steady, direct",
    },
    patterns: [],
    recent_summary: {
      available: recent_summary_available,
      summary_text: recent_summary_text,
    },
    today_context: {
      day_number: dayNumber,
      phase,
      staleness_mode,
      days_since_last_completion: daysSinceLastCompletion,
    },
    today_practice: {
      practice_summary: summarizePractice(actionItem),
    },
  };
}

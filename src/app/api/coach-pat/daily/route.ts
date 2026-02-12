export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import {
  resolveTrainingCampDay,
  type TrainingCampTrack,
} from "@/lib/training-camp-resolver";

import { generateCoachPatNote } from "@/lib/coach-pat-generator";
import { supabaseServer } from "@/lib/supabase-server";

const MAX_COACH_PAT_NOTES_PER_DAY = 30;

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ======================================================
 * Mojibake Fix
 * ======================================================
 *
 * You are currently seeing:
 *   youâ€™re
 *   Youâ€™ve
 *   itâ€™s
 *
 * That means curly apostrophes are being mis-decoded.
 *
 * This function fixes the most common ones safely.
 */
function fixMojibake(input: string): string {
  if (!input) return "";

  return input
    .replaceAll("â€™", "’")
    .replaceAll("â€˜", "‘")
    .replaceAll("â€œ", "“")
    .replaceAll("â€�", "”")
    .replaceAll("â€“", "–")
    .replaceAll("â€”", "—")
    .replaceAll("Â", "");
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated", error: "Unauthorized" },
        { status: 200 }
      );
    }

    const user = await currentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated", error: "Unauthorized" },
        { status: 200 }
      );
    }

    // ======================================================
    // ✅ Rate limit (cost guard)
    // ======================================================
    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("coach_pat_daily_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      console.error("Coach Pat daily usage lookup failed:", usageErr.message);

      // Fail closed (protect cost)
      return NextResponse.json(
        {
          ok: false,
          reason: "usage_check_failed",
          error: "Coach Pat is temporarily unavailable. Please try again later.",
        },
        { status: 200 }
      );
    }

    const usedCount = usageRows?.length ?? 0;

    if (usedCount >= MAX_COACH_PAT_NOTES_PER_DAY) {
      return NextResponse.json(
        {
          ok: false,
          reason: "rate_limited",
          error:
            "Coach Pat is quiet for today. Sit with today’s practice — that’s where it becomes real.",
          limitPerDay: MAX_COACH_PAT_NOTES_PER_DAY,
        },
        { status: 200 }
      );
    }

    // Record usage immediately (before OpenAI call)
    const { error: insertUsageErr } = await supabaseServer
      .from("coach_pat_daily_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });

    if (insertUsageErr) {
      console.error(
        "Coach Pat daily usage insert failed:",
        insertUsageErr.message
      );

      return NextResponse.json(
        {
          ok: false,
          reason: "usage_insert_failed",
          error: "Coach Pat is temporarily unavailable. Please try again later.",
        },
        { status: 200 }
      );
    }

    // ======================================================
    // Day param parse
    // ======================================================
    const url = new URL(req.url);
    const dayParam = url.searchParams.get("day");
    const dayNumber = Number(dayParam);

    if (!Number.isFinite(dayNumber) || dayNumber < 1) {
      return NextResponse.json(
        { ok: false, reason: "invalid_day", error: "Invalid day" },
        { status: 200 }
      );
    }

    // ======================================================
    // Resolve Training Camp practice (only for 1–30)
    // ======================================================
    const trackRaw = user.publicMetadata?.trainingCampTrack;
    const trainingCampTrack: TrainingCampTrack =
      trackRaw === "women" ? "women" : "standard";

    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

    const actionItem =
      practice?.action_item ??
      "Show up today with intention and hold the standard, even in small moments.";

    // ======================================================
    // Generate Coach Pat note (OpenAI)
    // ======================================================
    const rawNote = await generateCoachPatNote({
      userId,
      dayNumber,
      actionItem,
    });

    const note = fixMojibake(rawNote);

    return NextResponse.json({ ok: true, note }, { status: 200 });
  } catch (err) {
    console.error("Coach Pat daily API error:", err);

    return NextResponse.json(
      {
        ok: false,
        reason: "server_error",
        error: "Failed to generate Coach Pat note",
      },
      { status: 500 }
    );
  }
}

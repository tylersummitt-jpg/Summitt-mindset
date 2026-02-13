// src/app/api/coach-pat/daily/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import { generateDailyCoachPatMessage } from "@/lib/daily-coach-pat-engine";

const MAX_COACH_PAT_NOTES_PER_DAY = 30;

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // ----------------------------
    // RATE LIMIT (cost guard)
    // ----------------------------
    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("coach_pat_daily_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      return NextResponse.json(
        { ok: false, reason: "usage_check_failed" },
        { status: 200 }
      );
    }

    if ((usageRows?.length ?? 0) >= MAX_COACH_PAT_NOTES_PER_DAY) {
      return NextResponse.json(
        { ok: false, reason: "rate_limited" },
        { status: 200 }
      );
    }

    const { error: insertErr } = await supabaseServer
      .from("coach_pat_daily_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });

    if (insertErr) {
      return NextResponse.json(
        { ok: false, reason: "usage_insert_failed" },
        { status: 200 }
      );
    }

    // ----------------------------
    // DAY PARAM (optional override)
    // ----------------------------
    const url = new URL(req.url);
    const dayParam = url.searchParams.get("day");
    const dayNumber = dayParam ? Number(dayParam) : undefined;

    const result = await generateDailyCoachPatMessage({
      userId,
      dayNumber,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, note: result.note, cached: result.cached ?? false },
      { status: 200 }
    );
  } catch (err) {
    console.error("Coach Pat daily API error:", err);
    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

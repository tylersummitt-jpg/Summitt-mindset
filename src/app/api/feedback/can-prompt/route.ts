import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

import { isFeedbackPaused, getFeedbackState } from "@/lib/feedback-state";

/**
 * ======================================================
 * Feedback Prompt Guard (CANONICAL)
 * ======================================================
 *
 * This endpoint ONLY answers:
 * "Is it allowed to prompt right now?"
 *
 * It does NOT record prompt exposure.
 */

export async function GET(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ ok: false, canPrompt: false });
  }

  const url = new URL(req.url);
  const moment = url.searchParams.get("moment");

  if (!moment) {
    return NextResponse.json({ ok: false, canPrompt: false });
  }

  // --------------------------------------------------
  // ✅ 1. Already submitted this moment?
  // --------------------------------------------------
  const { data: existing } = await supabaseServer
    .from("feedback_events")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("moment", moment)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({
      ok: true,
      canPrompt: false,
      reason: "already_submitted",
    });
  }

  // --------------------------------------------------
  // ✅ 2. Pause Guard
  // --------------------------------------------------
  const paused = await isFeedbackPaused(userId);

  if (paused) {
    return NextResponse.json({
      ok: true,
      canPrompt: false,
      reason: "paused",
    });
  }

  // --------------------------------------------------
  // ✅ 3. Max 1 Prompt Per Day
  // --------------------------------------------------
  const state = await getFeedbackState(userId);
  const todayKey = new Date().toISOString().slice(0, 10);

  if (state.lastPromptedAt?.slice(0, 10) === todayKey) {
    return NextResponse.json({
      ok: true,
      canPrompt: false,
      reason: "already_prompted_today",
    });
  }

  // ✅ Allowed
  return NextResponse.json({
    ok: true,
    canPrompt: true,
  });
}

// src/app/api/coach-reply/route.ts

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { supabaseServer } from "@/lib/supabase-server";
import { generateCoachReply } from "@/lib/coach-reply-generator";

export const runtime = "nodejs";

const MAX_COACH_REPLIES_PER_DAY = 20;

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    // ================================
    // Rate Limit
    // ================================
    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("coach_reply_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      console.error("Coach reply usage lookup failed:", usageErr.message);
      return NextResponse.json(
        {
          ok: false,
          reason: "usage_check_failed",
          error:
            "Coach Pat is temporarily unavailable. Please try again later.",
        },
        { status: 200 }
      );
    }

    const usedCount = usageRows?.length ?? 0;

    if (usedCount >= MAX_COACH_REPLIES_PER_DAY) {
      return NextResponse.json(
        {
          ok: false,
          reason: "rate_limited",
          error:
            "You’ve hit today’s Coach Pat limit. Sit with what you wrote — that’s where growth happens.",
          limitPerDay: MAX_COACH_REPLIES_PER_DAY,
        },
        { status: 200 }
      );
    }

    await supabaseServer.from("coach_reply_usage").insert({
      clerk_user_id: userId,
      day_key: dayKey,
    });

    // ================================
    // Body
    // ================================
    const body = await req.json();

    const day = Number(body?.day);
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";

    if (!Number.isFinite(day) || day < 1 || message.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    // ================================
    // Save USER message
    // ================================
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: day,
      role: "user",
      content: message,
    });

    // ================================
    // Generate Coach Reply
    // ================================
    const coachReply = await generateCoachReply({
      userId,
      dayNumber: day,
      userMessage: message,
    });

    // ================================
    // Save COACH reply (FIXED)
    // ================================
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: day,
      role: "coach",
      content: coachReply.text,        // ✅ store ONLY text
      metadata: coachReply.meta,       // ✅ store meta separately
    });

    // ================================
    // Return Full Thread
    // ================================
    const { data: thread } = await supabaseServer
      .from("coach_conversations")
      .select("id, role, content, created_at")
      .eq("clerk_user_id", userId)
      .eq("day_number", day)
      .order("created_at", { ascending: true });

    return NextResponse.json(
      { ok: true, thread: thread ?? [] },
      { status: 200 }
    );
  } catch (err) {
    console.error("[COACH REPLY ERROR]", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
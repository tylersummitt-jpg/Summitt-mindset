import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { supabaseServer } from "@/lib/supabase-server";
import { generateCoachReply } from "@/lib/coach-reply-generator";

/**
 * ======================================================
 * POST /api/coach-reply
 * ======================================================
 *
 * Body:
 *   { day: number, message: string }
 *
 * Saves:
 *   - user message → coach_conversations
 *   - coach reply  → coach_conversations
 *
 * Returns:
 *   { ok: true, thread: Message[] }
 */

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

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

    // --------------------------------------------------
    // 1. Save USER message
    // --------------------------------------------------
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: day,
      role: "user",
      content: message,
    });

    // --------------------------------------------------
    // 2. Generate Coach Reply (≤4 sentences)
    // --------------------------------------------------
    const coachReply = await generateCoachReply({
      userId,
      dayNumber: day,
      userMessage: message,
    });

    // --------------------------------------------------
    // 3. Save COACH reply
    // --------------------------------------------------
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: day,
      role: "coach",
      content: coachReply,
    });

    // --------------------------------------------------
    // 4. Return Full Thread
    // --------------------------------------------------
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

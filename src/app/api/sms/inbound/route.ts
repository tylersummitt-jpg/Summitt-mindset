import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { clerkClient } from "@clerk/nextjs/server";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { completeDay } from "@/lib/complete-day";

/**
 * ======================================================
 * SMS INBOUND (CANONICAL + GUARDED)
 * ======================================================
 */

const MIN_REPLY_LENGTH = 12;

function normalizeText(input: string) {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, message } = body;

    if (typeof userId !== "string" || typeof message !== "string") {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    const normalizedMessage = normalizeText(message);

    // ---------------------------------------------
    // 🛑 REPLY TOO SHORT GUARD
    // ---------------------------------------------
    if (normalizedMessage.length < MIN_REPLY_LENGTH) {
      return NextResponse.json({
        ok: false,
        reason: "reply_too_short",
        message: "Write one honest sentence to complete today’s practice.",
      });
    }

    // ---------------------------------------------
    // Load user + progression
    // ---------------------------------------------
    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const metadata = user.publicMetadata || {};
    const currentDay =
      typeof metadata.currentDay === "number" ? metadata.currentDay : null;

    if (!currentDay) {
      return NextResponse.json(
        { error: "No active day" },
        { status: 400 }
      );
    }

    // ---------------------------------------------
    // 🛑 IDEMPOTENCY GUARD (already completed today)
    // ---------------------------------------------
    if (metadata.lastCompletedAt) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "already_completed_today",
      });
    }

    const trainingCampTrack =
      metadata.trainingCampTrack === "women" ? "women" : "standard";

    // ---------------------------------------------
    // Ensure daily prompt exists
    // ---------------------------------------------
    const { promptId, actionItem, reflectionPrompt } =
      await ensureDailyPrompt({
        userId,
        dayNumber: currentDay,
        trainingCampTrack,
      });

    // ---------------------------------------------
    // Save journal entry (SMS source)
    // ---------------------------------------------
    await supabaseServer.from("journal_entries").upsert(
      {
        clerk_user_id: userId,
        day_number: currentDay,
        content: normalizedMessage,
        prompt_id: promptId,
        action_item: actionItem,
        reflection_prompt: reflectionPrompt,
        source: "sms",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

    // ---------------------------------------------
    // Complete the day (CANONICAL)
    // ---------------------------------------------
    const result = await completeDay({
      userId,
      source: "sms",
    });

    if (!result.ok) {
      return NextResponse.json(result);
    }

    return NextResponse.json({
      ok: true,
      completedDay: result.completedDay,
      nextDay: result.nextDay,
      source: "sms",
    });
  } catch (err) {
    console.error("SMS inbound error:", err);

    return NextResponse.json(
      { error: "Failed to process inbound SMS" },
      { status: 500 }
    );
  }
}

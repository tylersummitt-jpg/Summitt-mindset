import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { clerkClient } from "@clerk/nextjs/server";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { completeDay } from "@/lib/complete-day";

/**
 * ======================================================
 * SMS INBOUND (CANONICAL)
 * ======================================================
 *
 * DOMAIN CONTRACT
 * ------------------------------------------------------
 * - SMS completion uses the SAME rules as app completion
 * - Domain failures return { ok:false, reason }
 * - Transport never hides domain intent
 */

const MIN_REPLY_LENGTH = 12;

function normalizeText(input: string) {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    const { userId, message } = body;

    if (typeof userId !== "string" || typeof message !== "string") {
      return NextResponse.json(
        { ok: false, reason: "invalid_payload" },
        { status: 200 }
      );
    }

    const normalizedMessage = normalizeText(message);

    if (normalizedMessage.length < MIN_REPLY_LENGTH) {
      return NextResponse.json({
        ok: false,
        reason: "reply_too_short",
        message: "Write one honest sentence to complete today’s practice.",
      });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const metadata = user.publicMetadata || {};
    const currentDay =
      typeof metadata.currentDay === "number" ? metadata.currentDay : null;

    if (!currentDay) {
      return NextResponse.json(
        { ok: false, reason: "no_current_day" },
        { status: 200 }
      );
    }

    // Idempotency guard
    if (metadata.lastCompletedAt) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "already_completed_today",
      });
    }

    const trainingCampTrack =
      metadata.trainingCampTrack === "women" ? "women" : "standard";

    const { promptId, actionItem, reflectionPrompt } =
      await ensureDailyPrompt({
        userId,
        dayNumber: currentDay,
        trainingCampTrack,
      });

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

    const result = await completeDay({
      userId,
      source: "sms",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[SMS INBOUND] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getDailyCoachPatMessageForSMS } from "@/lib/daily-coach-pat-message";

/**
 * DEBUG ONLY
 *
 * Local preview endpoint for Daily SMS.
 * This does NOT send SMS.
 * This does NOT update Clerk or Supabase.
 *
 * It simply returns the exact Coach Pat message
 * that WOULD be sent via SMS today.
 */

// ✅ REQUIRED: ensure this route is never statically evaluated
export const dynamic = "force-dynamic";

// ✅ REQUIRED: Clerk + Supabase + OpenAI must run in Node
export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await getDailyCoachPatMessageForSMS(userId);

    return NextResponse.json({
      preview: true,
      ...result,
    });
  } catch (err) {
    console.error("Daily SMS preview error:", err);

    return NextResponse.json(
      { error: "Failed to generate SMS preview" },
      { status: 500 }
    );
  }
}

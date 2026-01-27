import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDailyCoachPatMessageForSMS } from "@/lib/daily-coach-pat-message";

/**
 * ======================================================
 * DEBUG — DAILY SMS PREVIEW (LOCAL ONLY)
 * ======================================================
 *
 * This route:
 * - NEVER sends SMS
 * - NEVER mutates data
 * - NEVER advances progression
 *
 * It is a pure read-only preview endpoint.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    const result = await getDailyCoachPatMessageForSMS(userId);

    return NextResponse.json({
      ok: true,
      preview: true,
      ...result,
    });
  } catch (err) {
    console.error("[SMS PREVIEW] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

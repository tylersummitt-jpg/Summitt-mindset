import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * POST /api/day/complete — retained URL only (PR7). Day-numbered completion / Clerk progression
 * is no longer the accountability path; V2 uses SMS + commitment.
 *
 * Domain failures → HTTP 200
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

    try {
      await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        reason: "day_completion_removed",
        message:
          "Completing a numbered day here is no longer supported. Accountability is on your commitment by text; use the dashboard for practice or depth if you want it.",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[day/complete] server error", err);
    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

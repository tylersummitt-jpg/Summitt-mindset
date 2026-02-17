import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * SMS INBOUND (DEPRECATED)
 * ======================================================
 *
 * This route was used for local testing with JSON payloads.
 *
 * The real inbound system is now:
 *   /api/twilio/inbound
 *
 * Keeping this enabled is dangerous because it can create
 * divergent behavior and accidental double completion.
 */

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      reason: "deprecated",
      message: "Use /api/twilio/inbound",
    },
    { status: 200 }
  );
}

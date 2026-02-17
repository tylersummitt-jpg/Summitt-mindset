// src/app/api/coach-pat/daily/route.ts

export const runtime = "nodejs";

/**
 * ⚠️ DEPRECATED ROUTE
 *
 * This route previously generated Coach Pat daily notes.
 * The system now uses the canonical server-side engine:
 *
 * - App: server component calls generateDailyCoachPatMessage()
 * - SMS: cron + Twilio calls generateDailyCoachPatMessage()
 *
 * We intentionally disable this endpoint to prevent:
 * - accidental regeneration
 * - rate limit bypass
 * - divergence bugs
 * - future AI widget regression
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      reason: "deprecated_route_use_canonical_engine",
    },
    { status: 410 }
  );
}

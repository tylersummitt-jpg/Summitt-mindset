import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { completeDay } from "@/lib/complete-day";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";

/**
 * ======================================================
 * POST /api/day/complete (CANONICAL)
 * ======================================================
 *
 * IMPORTANT DOMAIN CONTRACT
 * ------------------------------------------------------
 * Domain failures are returned via:
 *   { ok: false, reason: string }
 *
 * This route MUST ALWAYS return HTTP 200 for
 * expected domain outcomes.
 *
 * HTTP status codes are reserved ONLY for:
 * - 500 → unexpected server crashes
 *
 * Transport must never hide domain intent.
 *
 * NEW CANONICAL RULE:
 * ------------------------------------------------------
 * Client must only complete the CURRENT day.
 * If client sends a day that does not match metadata.currentDay,
 * we return a domain error:
 *   { ok:false, reason:"day_mismatch" }
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    const pageDay = body?.day;

    const videoIdShown =
      typeof body?.videoIdShown === "string" &&
      body.videoIdShown.trim().length > 0
        ? body.videoIdShown.trim()
        : null;

    if (typeof pageDay !== "number" || !Number.isFinite(pageDay)) {
      return NextResponse.json(
        { ok: false, reason: "invalid_day" },
        { status: 200 }
      );
    }

    // ======================================================
    // ✅ CANONICAL DAY MATCH GUARD
    // ======================================================
    // We only allow completing the current day.
    // This prevents completing the wrong day due to:
    // - multiple tabs
    // - stale page
    // - manual URL navigation
    // - race conditions
    const md = await getClerkPublicMetadata(userId);

    const currentDay =
      typeof md.currentDay === "number" && md.currentDay > 0 ? md.currentDay : null;

    if (!currentDay) {
      return NextResponse.json(
        { ok: false, reason: "no_current_day" },
        { status: 200 }
      );
    }

    if (pageDay !== currentDay) {
      return NextResponse.json(
        {
          ok: false,
          reason: "day_mismatch",
          expectedDay: currentDay,
          gotDay: pageDay,
        },
        { status: 200 }
      );
    }

    // ======================================================
    // CANONICAL COMPLETION
    // ======================================================
    const result = await completeDay({
      userId,
      source: "app",
      videoIdShown,
    });

    // Always return canonical result (success OR failure)
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // True server failure only
    console.error("[DAY COMPLETE] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}

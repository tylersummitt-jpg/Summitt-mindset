import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { completeDay } from "@/lib/complete-day";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { reconcileSmsDeliveryStateAfterCompletion } from "@/lib/sms-delivery-on-complete";

/**
 * ======================================================
 * POST /api/day/complete (CANONICAL)
 * ======================================================
 *
 * Domain failures → HTTP 200
 * Server crashes → HTTP 500
 *
 * Client may only complete CURRENT day.
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

    if (typeof pageDay !== "number" || !Number.isFinite(pageDay)) {
      return NextResponse.json(
        { ok: false, reason: "invalid_day" },
        { status: 200 }
      );
    }

    // ======================================================
    // CANONICAL DAY MATCH GUARD
    // ======================================================
    const md = await getClerkPublicMetadata(userId);

    const currentDay =
      typeof md.currentDay === "number" && md.currentDay > 0
        ? md.currentDay
        : null;

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
    });

    if (result.ok) {
      try {
        const reconcileResult =
          await reconcileSmsDeliveryStateAfterCompletion(userId);
        if (!reconcileResult.ok) {
          console.error(
            "[day/complete] sms_delivery_state reconcile failed after completeDay",
            { userId, error: reconcileResult.error }
          );
        }
      } catch (reconcileErr) {
        console.error(
          "[day/complete] sms_delivery_state reconcile threw",
          userId,
          reconcileErr
        );
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[DAY COMPLETE] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
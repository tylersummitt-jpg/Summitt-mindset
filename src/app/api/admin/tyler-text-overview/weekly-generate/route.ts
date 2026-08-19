import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { generateTylerTextOverviewWeeklyDraftForUser } from "@/lib/tyler-text-overview-weekly-generate";
import { SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminErrorResponse(err: unknown) {
  const status =
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  const message = err instanceof Error ? err.message : "unknown_error";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    await requireTylerAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const clerkUserId =
      body != null &&
      typeof body === "object" &&
      "clerk_user_id" in body &&
      typeof (body as { clerk_user_id: unknown }).clerk_user_id === "string"
        ? (body as { clerk_user_id: string }).clerk_user_id.trim()
        : "";

    if (!clerkUserId) {
      return NextResponse.json({ ok: false, error: "clerk_user_id required" }, { status: 400 });
    }

    const result = await generateTylerTextOverviewWeeklyDraftForUser({ clerkUserId });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? result.reason, reason: result.reason },
        { status: result.reason === "disabled" ? 503 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      send_slot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
      clerk_user_id: clerkUserId,
      draft_for_day_key: result.draftForDayKey,
      week_key: result.weekKey,
      week_start: result.weekStart,
      week_end: result.weekEnd,
      timezone: result.timezone,
      generation_id: result.generationId,
      machine_should_send: result.machineShouldSend,
      machine_draft_body: result.machineDraftBody,
      machine_no_send_reason: result.machineNoSendReason,
      current_draft_protected: result.currentDraftProtected === true,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-generate] POST failed", err);
    return adminErrorResponse(err);
  }
}

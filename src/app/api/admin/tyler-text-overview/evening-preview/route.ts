import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { generateTylerTextOverviewEveningPreviewForUser } from "@/lib/tyler-text-overview-generate";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";

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

    const draftForDayKey =
      body != null &&
      typeof body === "object" &&
      "draft_for_day_key" in body &&
      typeof (body as { draft_for_day_key: unknown }).draft_for_day_key === "string"
        ? (body as { draft_for_day_key: string }).draft_for_day_key.trim() || undefined
        : undefined;

    const result = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId,
      draftForDayKey,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? result.reason, reason: result.reason },
        { status: result.reason === "disabled" ? 503 : 400 }
      );
    }

    const previewBody = result.built.ok ? result.built.smsBody : null;
    const machineShouldSend = result.built.ok;

    return NextResponse.json({
      ok: true,
      preview_only: true,
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      clerk_user_id: clerkUserId,
      draft_for_day_key: result.draftForDayKey,
      generation_id: result.generationId,
      machine_should_send: machineShouldSend,
      machine_draft_body: previewBody,
      morning_anchor_source: result.morningAnchorSource,
      slot_coaching_context: result.slotCoachingContext,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/evening-preview] POST failed", err);
    return adminErrorResponse(err);
  }
}

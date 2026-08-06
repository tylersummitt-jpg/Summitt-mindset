import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { sendTylerTextOverviewEveningDraft } from "@/lib/tyler-text-overview-evening-send";

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

function refusalStatus(code: string): number {
  switch (code) {
    case "evening_proactive_send_disabled":
      return 410;
    case "draft_not_found":
      return 404;
    case "draft_not_current":
    case "wrong_send_slot":
    case "preview_body_missing":
    case "machine_should_send_false":
    case "already_sent_evening_today":
    case "already_reserved_evening_today":
    case "no_phone":
    case "sms_disabled":
    case "stopped_or_unsubscribed":
    case "paused_or_canceled":
    case "not_fully_on_v2":
    case "user_completed_today":
    case "body_empty":
    case "body_too_long":
    case "stale_preview":
      return 409;
    case "twilio_not_configured":
      return 503;
    case "twilio_failed":
    case "reservation_failed":
    case "post_send_bookkeeping_failed":
      return 502;
    default:
      return 400;
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireTylerAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const draftId =
      body != null &&
      typeof body === "object" &&
      "draft_id" in body &&
      typeof (body as { draft_id: unknown }).draft_id === "string"
        ? (body as { draft_id: string }).draft_id.trim()
        : "";

    if (!draftId) {
      return NextResponse.json({ ok: false, error: "draft_id required" }, { status: 400 });
    }

    const result = await sendTylerTextOverviewEveningDraft({
      draftId,
      requestedByClerkUserId: userId,
      mode: "manual_one",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: refusalStatus(result.refusalCode) });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/tyler-text-overview/evening-send] POST failed", err);
    return adminErrorResponse(err);
  }
}

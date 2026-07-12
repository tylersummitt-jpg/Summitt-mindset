import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { sendWeeklyTtoDraftManually } from "@/lib/tyler-text-overview-weekly-send";

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
    case "no_draft":
      return 404;
    case "wrong_slot":
    case "draft_not_current":
    case "missing_generation":
    case "week_key_mismatch":
    case "blank_body":
    case "machine_should_send_false":
    case "duplicate_weekly_send":
    case "no_phone":
    case "sms_disabled":
    case "stopped_or_unsubscribed":
    case "paused_or_canceled":
    case "not_fully_on_v2":
    case "no_commitment":
      return 409;
    case "twilio_not_ready":
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

    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const record = body as Record<string, unknown>;

    if ("draft_ids" in record || "clerk_user_ids" in record || Array.isArray(record.draft_id)) {
      return NextResponse.json(
        { ok: false, error: "bulk_not_supported", message: "One-row send only" },
        { status: 400 }
      );
    }

    if (record.force === true || record.dryRun === true || record.dry_run === true) {
      return NextResponse.json(
        { ok: false, error: "unsupported_flag", message: "force/dryRun are not supported" },
        { status: 400 }
      );
    }

    const draftId = typeof record.draft_id === "string" ? record.draft_id.trim() : "";
    if (!draftId) {
      return NextResponse.json({ ok: false, error: "draft_id required" }, { status: 400 });
    }

    const weekKey =
      typeof record.week_key === "string" && record.week_key.trim()
        ? record.week_key.trim()
        : null;

    const result = await sendWeeklyTtoDraftManually({
      draftId,
      weekKey,
      requestedByClerkUserId: userId,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.refusalCode,
          refusalCode: result.refusalCode,
          message: result.message,
          draft_id: result.draftId ?? null,
          clerk_user_id: result.clerkUserId ?? null,
          week_key: result.weekKey ?? null,
        },
        { status: refusalStatus(result.refusalCode) }
      );
    }

    return NextResponse.json({
      ok: true,
      draft_id: result.draftId,
      clerk_user_id: result.clerkUserId,
      week_key: result.weekKey,
      message_sid: result.messageSid,
      status: result.status,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-send] POST failed", err);
    return adminErrorResponse(err);
  }
}

import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  keepSmsOptOutReviewTextsOn,
  stopSmsOptOutReviewTexts,
} from "@/lib/sms-opt-out-review-resolve";

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

export async function POST(
  req: Request,
  context: { params: Promise<{ messageSid: string }> }
) {
  try {
    await requireTylerAdmin();
    const { messageSid } = await context.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (body == null || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const action = (body as { action?: unknown }).action;
    const latestInboundAt = (body as { latest_inbound_at?: unknown }).latest_inbound_at;
    if (typeof latestInboundAt !== "string" || !latestInboundAt.trim()) {
      return NextResponse.json(
        { ok: false, error: "Look at the conversation again before deciding." },
        { status: 400 }
      );
    }

    const args = { messageSid, latestInboundAt };
    const result =
      action === "stop_texts"
        ? await stopSmsOptOutReviewTexts(args)
        : action === "keep_texts_on"
          ? await keepSmsOptOutReviewTextsOn(args)
          : null;

    if (!result) {
      return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          outcome: result.outcome,
          card: result.card ?? null,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch (err) {
    console.error("[admin/sms-opt-out-reviews] POST failed", err);
    return adminErrorResponse(err);
  }
}

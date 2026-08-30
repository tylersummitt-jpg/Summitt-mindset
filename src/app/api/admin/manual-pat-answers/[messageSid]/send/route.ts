import { NextResponse } from "next/server";

import { sendManualPatCoachReply } from "@/lib/admin-manual-pat-answers";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

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
  _req: Request,
  context: { params: Promise<{ messageSid: string }> }
) {
  try {
    await requireTylerAdmin();
    const { messageSid } = await context.params;
    const result = await sendManualPatCoachReply(messageSid);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      outboundMessageSid: result.outboundMessageSid,
      sentAt: result.sentAt,
    });
  } catch (err) {
    console.error("[admin/manual-pat-answers] POST send failed", err);
    return adminErrorResponse(err);
  }
}

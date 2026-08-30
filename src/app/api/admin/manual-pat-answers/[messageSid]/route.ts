import { NextResponse } from "next/server";

import { saveManualPatDraft } from "@/lib/admin-manual-pat-answers";
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

export async function PATCH(
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

    if (
      body == null ||
      typeof body !== "object" ||
      !("reply_body" in body) ||
      typeof (body as { reply_body: unknown }).reply_body !== "string"
    ) {
      return NextResponse.json(
        { ok: false, error: "reply_body must be a string" },
        { status: 400 }
      );
    }

    const result = await saveManualPatDraft({
      messageSid,
      replyBody: (body as { reply_body: string }).reply_body,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, replyBody: result.replyBody });
  } catch (err) {
    console.error("[admin/manual-pat-answers] PATCH failed", err);
    return adminErrorResponse(err);
  }
}

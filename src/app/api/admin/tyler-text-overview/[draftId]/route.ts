import { NextResponse } from "next/server";

import { updateTylerTextOverviewDraftBody } from "@/lib/tyler-text-overview-admin";
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
  context: { params: Promise<{ draftId: string }> }
) {
  try {
    await requireTylerAdmin();
    const { draftId } = await context.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const currentBodyToSend =
      body != null &&
      typeof body === "object" &&
      "currentBodyToSend" in body &&
      (typeof (body as { currentBodyToSend: unknown }).currentBodyToSend === "string" ||
        (body as { currentBodyToSend: unknown }).currentBodyToSend === null)
        ? ((body as { currentBodyToSend: string | null }).currentBodyToSend ?? "")
        : null;

    if (currentBodyToSend === null) {
      return NextResponse.json(
        { ok: false, error: "currentBodyToSend must be a string or null" },
        { status: 400 }
      );
    }

    const result = await updateTylerTextOverviewDraftBody({
      draftId,
      body: currentBodyToSend,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, row: result.row });
  } catch (err) {
    console.error("[admin/tyler-text-overview] PATCH failed", err);
    return adminErrorResponse(err);
  }
}

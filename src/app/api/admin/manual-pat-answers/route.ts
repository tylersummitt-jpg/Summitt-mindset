import { NextResponse } from "next/server";

import { listManualPatAnswers } from "@/lib/admin-manual-pat-answers";
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

export async function GET() {
  try {
    await requireTylerAdmin();
    const rows = await listManualPatAnswers();
    return NextResponse.json(
      { ok: true, rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[admin/manual-pat-answers] GET failed", err);
    return adminErrorResponse(err);
  }
}

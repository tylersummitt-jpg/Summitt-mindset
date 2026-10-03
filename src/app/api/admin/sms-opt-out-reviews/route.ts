import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { listOpenSmsOptOutReviews } from "@/lib/sms-opt-out-review-resolve";

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
    const rows = await listOpenSmsOptOutReviews();
    return NextResponse.json(
      { ok: true, rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[admin/sms-opt-out-reviews] GET failed", err);
    return adminErrorResponse(err);
  }
}

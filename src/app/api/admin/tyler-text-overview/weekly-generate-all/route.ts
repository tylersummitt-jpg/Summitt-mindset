import { NextResponse } from "next/server";

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

export async function POST() {
  try {
    await requireTylerAdmin();
    return NextResponse.json(
      { ok: false, error: "weekly_delivery_retired", retired: true },
      { status: 410 }
    );
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-generate-all] POST failed", err);
    return adminErrorResponse(err);
  }
}

import { NextResponse } from "next/server";

import {
  listCurrentTylerTextOverviewDrafts,
  resolveAdminListSendSlot,
} from "@/lib/tyler-text-overview-admin";
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

export async function GET(req: Request) {
  try {
    await requireTylerAdmin();

    const url = new URL(req.url);
    const draftForDayKey = url.searchParams.get("draft_for_day_key");
    const sendSlot = resolveAdminListSendSlot(url.searchParams.get("send_slot"));

    const rows = await listCurrentTylerTextOverviewDrafts({
      draftForDayKey,
      sendSlot,
    });

    const availableDayKeys = [...new Set(rows.map((r) => r.draftForDayKey))].sort((a, b) =>
      b.localeCompare(a)
    );

    return NextResponse.json({
      ok: true,
      rows,
      availableDayKeys,
      sendSlot,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview] GET failed", err);
    return adminErrorResponse(err);
  }
}

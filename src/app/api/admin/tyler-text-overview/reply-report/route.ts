import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  buildTylerTextOverviewReplyReport,
  parseTtoReplyReportRange,
} from "@/lib/tyler-text-overview-reply-report";

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

/** Observe-only Morning vs Evening reply report. No mutations. */
export async function GET(req: Request) {
  try {
    await requireTylerAdmin();

    const url = new URL(req.url);
    const range = parseTtoReplyReportRange(url.searchParams.get("range"));
    const report = await buildTylerTextOverviewReplyReport({ range });

    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[admin/tyler-text-overview/reply-report] GET failed", err);
    return adminErrorResponse(err);
  }
}

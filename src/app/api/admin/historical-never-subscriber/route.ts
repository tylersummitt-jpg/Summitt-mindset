import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  IncompleteHistoricalCohortError,
  buildHistoricalNeverSubscriberCsvExport,
} from "@/lib/historical-never-subscriber.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function denied(err: unknown) {
  const status =
    err != null && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 401;
  return NextResponse.json({ error: status === 403 ? "Forbidden" : "Unauthorized" }, { status });
}

export async function GET() {
  try {
    await requireTylerAdmin();
  } catch (err) {
    return denied(err);
  }
  try {
    const result = await buildHistoricalNeverSubscriberCsvExport();
    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="historical-never-subscriber.csv"',
        "Cache-Control": "no-store",
        "X-Export-Cohort": String(result.counts.cohort),
        "X-Export-Test-Internal": String(result.counts.testInternal),
        "X-Export-Former": String(result.counts.confirmedFormer),
        "X-Export-Active": String(result.counts.activeMembership),
        "X-Export-Strong-Never": String(result.counts.strongNeverSubscriber),
        "X-Export-Unknown": String(result.counts.unknownIncomplete),
        "X-Export-Prospects": String(result.counts.prospects),
      },
    });
  } catch (err) {
    if (err instanceof IncompleteHistoricalCohortError) {
      return NextResponse.json({ error: "incomplete_clerk_list" }, { status: 503 });
    }
    console.error("[historical-never-subscriber] failed");
    return NextResponse.json({ error: "export_failed" }, { status: 503 });
  }
}

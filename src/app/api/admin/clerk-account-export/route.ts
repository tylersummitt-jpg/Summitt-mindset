import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { IncompleteClerkExportError, buildClerkAccountExport } from "@/lib/clerk-account-export.server";

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
    const result = await buildClerkAccountExport();
    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="clerk-account-export.csv"',
        "Cache-Control": "no-store",
        "X-Export-Examined": String(result.counts.examined),
        "X-Export-Excluded-Test": String(result.counts.excludedTest),
        "X-Export-Active": String(result.counts.active),
        "X-Export-Former": String(result.counts.former),
        "X-Export-Verified-Never": String(result.counts.verifiedNeverSubscriber),
        "X-Export-Unknown": String(result.counts.unknown),
      },
    });
  } catch (err) {
    if (err instanceof IncompleteClerkExportError) {
      return NextResponse.json({ error: "incomplete_clerk_list" }, { status: 503 });
    }
    console.error("[clerk-account-export] failed");
    return NextResponse.json({ error: "export_failed" }, { status: 503 });
  }
}

import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { parseGenerateAllRequestBody } from "@/lib/tyler-text-overview-generate-all";
import { runManualScheduledGenerateAll } from "@/lib/tto-scheduled-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Chunked Sol generation; hard ceiling. Soft budget stops work earlier. */
export const maxDuration = 300;

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

export async function POST(req: Request) {
  try {
    await requireTylerAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseGenerateAllRequestBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    // The posted date is the administrative batch date. Draft keys are member-local.
    const result = await runManualScheduledGenerateAll({
      draftForDayKey: parsed.draftForDayKey,
      owner: "evening",
      audienceClerkUserIds: parsed.audienceClerkUserIds,
      excludeOccurrenceKeys: parsed.excludeOccurrenceKeys,
      failedOnly: parsed.failedOnly,
    });

    if ("status" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: result.ok,
      result,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/evening-generate-all] POST failed", err);
    return adminErrorResponse(err);
  }
}

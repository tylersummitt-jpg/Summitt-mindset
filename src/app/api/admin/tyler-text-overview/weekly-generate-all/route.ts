import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  generateWeeklyTtoDraftBatch,
  parseWeeklyGenerateAllRequestBody,
} from "@/lib/tyler-text-overview-weekly-generate-all";

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

    let body: unknown = {};
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
    } else {
      try {
        const text = await req.text();
        if (text.trim()) {
          body = JSON.parse(text);
        }
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
    }

    const parsed = parseWeeklyGenerateAllRequestBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const result = await generateWeeklyTtoDraftBatch({
      audienceClerkUserIds: parsed.audienceClerkUserIds,
      excludeClerkUserIds: parsed.excludeClerkUserIds,
    });

    if ("status" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-generate-all] POST failed", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    if (message === "tyler_text_overview_disabled") {
      return NextResponse.json({ ok: false, error: message }, { status: 503 });
    }
    return adminErrorResponse(err);
  }
}

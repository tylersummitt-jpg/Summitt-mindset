import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { generateMorningTtoDraftBatch } from "@/lib/tyler-text-overview-generate-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Sequential Sol generation for the sendable TTO audience; allow longer than default. */
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

    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const record = body as Record<string, unknown>;
    const draftForDayKey =
      typeof record.draft_for_day_key === "string" ? record.draft_for_day_key : "";

    // Slot is server-authoritative: morning. Never trust client slot.
    const result = await generateMorningTtoDraftBatch({ draftForDayKey });

    if ("status" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: result.ok,
      result,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/morning-generate-all] POST failed", err);
    return adminErrorResponse(err);
  }
}

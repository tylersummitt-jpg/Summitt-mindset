import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { bulkApplyWeeklyTtoDraftBodies } from "@/lib/tyler-text-overview-weekly-bulk-save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REJECTED_CLIENT_AUTHORITY_KEYS = [
  "clerk_user_id",
  "clerk_user_ids",
  "clerkUserId",
  "clerkUserIds",
  "user_id",
  "user_ids",
  "userId",
  "userIds",
  "rows",
  "draft_ids",
  "draftIds",
] as const;

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
    if (REJECTED_CLIENT_AUTHORITY_KEYS.some((key) => key in record)) {
      return NextResponse.json(
        { ok: false, error: "Client user or draft ids are not accepted" },
        { status: 400 }
      );
    }

    const draftForDayKey =
      typeof record.draft_for_day_key === "string" ? record.draft_for_day_key : "";
    const operation = typeof record.operation === "string" ? record.operation.trim() : "";
    if (operation !== "apply_all") {
      return NextResponse.json(
        { ok: false, error: "operation must be apply_all" },
        { status: 400 }
      );
    }
    if (typeof record.body !== "string") {
      return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
    }

    const result = await bulkApplyWeeklyTtoDraftBodies({
      draftForDayKey,
      body: record.body,
    });

    if ("status" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: result.ok,
      result,
    });
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-bulk-save] POST failed", err);
    return adminErrorResponse(err);
  }
}

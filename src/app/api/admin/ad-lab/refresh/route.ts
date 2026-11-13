import { NextResponse } from "next/server";

import { runAdLabImport } from "@/lib/ad-lab-import";
import { adLabImportClientMessage } from "@/lib/ad-lab-import-pure";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authStatus(err: unknown): number {
  if (
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return 500;
}

/**
 * Runs the same recent Meta import as the twice-daily schedule.
 * Does not accept a date window, so it cannot pull older history.
 */
export async function POST() {
  try {
    await requireTylerAdmin();
  } catch (err) {
    const status = authStatus(err);
    const error =
      status === 401
        ? "Sign in is required."
        : status === 403
          ? "This account cannot refresh Meta data."
          : "Meta could not be refreshed.";
    return NextResponse.json({ ok: false, error }, { status });
  }

  try {
    const result = await runAdLabImport();
    if (!result.ok) {
      const status = result.reason === "busy" || result.reason === "cooldown" ? 429 : 502;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: adLabImportClientMessage(result.reason) },
        { status }
      );
    }
    return NextResponse.json({ ok: true, since: result.since, until: result.until });
  } catch {
    console.error("[meta-ad-lab] refresh_failed");
    return NextResponse.json(
      { ok: false, error: "Meta could not be refreshed. The stored results are unchanged." },
      { status: 500 }
    );
  }
}

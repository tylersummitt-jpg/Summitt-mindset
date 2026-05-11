import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { maySetCoachAcquisitionSource } from "@/lib/coach-attribution";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

/**
 * POST /api/attribution/coach
 *
 * Sets publicMetadata.acquisitionSource to "coach" for the authenticated user
 * when maySetCoachAcquisitionSource allows. Idempotent; no-op if already set or blocked.
 * Does not trust client body — current session user only.
 */

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let existing: Record<string, unknown>;
  try {
    existing = await getClerkPublicMetadata(userId);
  } catch (err) {
    console.warn("[api/attribution/coach] getClerkPublicMetadata failed", err);
    return NextResponse.json(
      { ok: false, error: "metadata_unavailable" },
      { status: 502 }
    );
  }

  if (!maySetCoachAcquisitionSource(existing?.acquisitionSource)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    await updateClerkPublicMetadata(userId, { acquisitionSource: "coach" });
  } catch (err) {
    console.error("[api/attribution/coach] updateClerkPublicMetadata failed", err);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: true });
}

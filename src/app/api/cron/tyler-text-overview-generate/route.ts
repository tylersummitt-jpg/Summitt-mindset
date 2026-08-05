import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { resolveCanonicalMorningTtoBatchDraftForDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import { generateTylerTextOverviewDailyDrafts } from "@/lib/tyler-text-overview-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Morning TTO noon batch: one canonical draft day for every user.
 * Day = Eastern admin calendar today + 1 (next Morning accountability day).
 */
export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const draftForDayKey = resolveCanonicalMorningTtoBatchDraftForDayKey(now);
  const stats = await generateTylerTextOverviewDailyDrafts({ now, draftForDayKey });
  return NextResponse.json(stats);
}

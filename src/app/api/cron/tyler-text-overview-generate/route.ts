import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { generateTylerTextOverviewDailyDrafts } from "@/lib/tyler-text-overview-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stats = await generateTylerTextOverviewDailyDrafts({ now: new Date() });
  return NextResponse.json(stats);
}

import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import {
  parseTylerTextOverviewStaleRefreshReason,
  refreshStaleTylerTextOverviewDrafts,
} from "@/lib/tyler-text-overview-refresh-stale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const generationReason = parseTylerTextOverviewStaleRefreshReason(
    url.searchParams.get("reason")
  );

  const stats = await refreshStaleTylerTextOverviewDrafts({
    now: new Date(),
    generationReason,
  });

  return NextResponse.json(stats);
}

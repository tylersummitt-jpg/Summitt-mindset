import { NextResponse } from "next/server";

import { backfillExecuteAllowed } from "@/lib/acquisition/backfill";
import {
  applyInstantlyBackfill,
  dryRunInstantlyBackfill,
  fetchInstantlyBackfillSource,
} from "@/lib/acquisition/store";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let execute = false;
  try {
    const body = await request.json() as { execute?: unknown };
    execute = body.execute === true;
  } catch {
    execute = false;
  }
  const source = await fetchInstantlyBackfillSource();
  const plan = await dryRunInstantlyBackfill(source);
  const report = { ...plan, proposals: plan.proposals.length, schedulesWarmEmail: false as const };
  if (!execute || !backfillExecuteAllowed(plan)) {
    return NextResponse.json({
      dryRun: true,
      refused: execute && !backfillExecuteAllowed(plan) ? "incomplete" : null,
      ...report,
    });
  }
  const applied = await applyInstantlyBackfill(plan.proposals);
  return NextResponse.json({ dryRun: false, ...report, written: applied.written });
}

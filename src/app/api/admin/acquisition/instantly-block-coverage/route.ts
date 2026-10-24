import { NextResponse } from "next/server";

import {
  applyInstantlyBlockCoverage,
  previewInstantlyBlockCoverage,
} from "@/lib/acquisition/instantly-block.server";
import type { InstantlyBlockReason } from "@/lib/acquisition/instantly-block";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REASONS = ["trial_started", "paid_member", "unsubscribe", "complaint", "bounce"] as const;

function reasonCounts(proposals: readonly { reason: InstantlyBlockReason }[]) {
  const counts: Record<(typeof REASONS)[number], number> = {
    trial_started: 0,
    paid_member: 0,
    unsubscribe: 0,
    complaint: 0,
    bounce: 0,
  };
  for (const proposal of proposals) counts[proposal.reason] += 1;
  return counts;
}

export async function POST(request: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let apply = false;
  try {
    const body = await request.json() as { apply?: unknown };
    apply = body.apply === true;
  } catch {
    apply = false;
  }
  const report = await previewInstantlyBlockCoverage();
  const summary = {
    readable: report.readable,
    complete: report.complete,
    missing: report.proposals.length,
    alreadyCovered: report.alreadyCovered,
    byReason: reasonCounts(report.proposals),
    excluded: report.excluded,
  };
  if (!apply || !report.readable || !report.complete) {
    return NextResponse.json({
      dryRun: true,
      refused: apply && (!report.readable || !report.complete) ? "incomplete" : null,
      ...summary,
    });
  }
  const applied = await applyInstantlyBlockCoverage(report.proposals);
  return NextResponse.json({
    dryRun: false,
    stored: applied.stored,
    failed: applied.failed,
    ...summary,
  });
}

import { NextResponse } from "next/server";

import {
  applyInstantlyBackfill,
  dryRunInstantlyBackfill,
  fetchInstantlyLeads,
} from "@/lib/acquisition/store";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const leads = await fetchInstantlyLeads();
  const plan = await dryRunInstantlyBackfill(leads);
  if (!execute) {
    return NextResponse.json({
      dryRun: true,
      ...plan,
      proposals: plan.proposals.length,
    });
  }
  const applied = await applyInstantlyBackfill(plan.proposals);
  return NextResponse.json({ dryRun: false, ...plan, proposals: plan.proposals.length, written: applied.written });
}

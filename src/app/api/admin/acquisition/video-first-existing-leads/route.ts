import { NextResponse } from "next/server";

import { prepareExistingInstantlyLeads } from "@/lib/acquisition/instantly-existing-leads.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as {
    campaignId?: unknown;
    personalVideoId?: unknown;
    startingAfter?: unknown;
  } | null;
  const result = await prepareExistingInstantlyLeads({
    campaignId: typeof body?.campaignId === "string" ? body.campaignId : "",
    personalVideoId: typeof body?.personalVideoId === "string" ? body.personalVideoId : "",
    startingAfter: typeof body?.startingAfter === "string" ? body.startingAfter : null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}

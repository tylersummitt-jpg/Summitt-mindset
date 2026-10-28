import { NextResponse } from "next/server";

import { prepareVideoFirstLeads } from "@/lib/acquisition/video-first-leads.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { campaignId?: unknown; personalVideoId?: unknown; prospects?: unknown } | null;
  const result = await prepareVideoFirstLeads({
    campaignId: typeof body?.campaignId === "string" ? body.campaignId : "",
    personalVideoId: typeof body?.personalVideoId === "string" ? body.personalVideoId : "",
    prospects: typeof body?.prospects === "string" ? body.prospects : "",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}

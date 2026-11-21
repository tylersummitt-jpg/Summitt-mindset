import { NextResponse } from "next/server";

import { checkLetterAudience } from "@/lib/acquisition/letter-audience.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as {
    sourceCampaignId?: unknown;
    launchCampaignId?: unknown;
    pairCampaignId?: unknown;
  } | null;
  const result = await checkLetterAudience({
    sourceCampaignId: typeof body?.sourceCampaignId === "string" ? body.sourceCampaignId : "",
    launchCampaignId: typeof body?.launchCampaignId === "string" ? body.launchCampaignId : "",
    pairCampaignId: typeof body?.pairCampaignId === "string" ? body.pairCampaignId : null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}

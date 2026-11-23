import { NextResponse } from "next/server";

import { signedLeadershipKitLink, signedPlaybookLink } from "@/lib/acquisition/playbook-link.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { campaignId?: unknown; kind?: unknown } | null;
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
  const result = body?.kind === "kit" ? await signedLeadershipKitLink(campaignId) : await signedPlaybookLink(campaignId);
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}

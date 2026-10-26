import { NextResponse } from "next/server";

import { listCampaignPlaybooks, saveCampaignPlaybook, setCampaignPlaybookStatus } from "@/lib/acquisition/playbook.server";
import type { PlaybookDraft, PlaybookFulfillment, PlaybookSendAction } from "@/lib/acquisition/playbook";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function draftFrom(body: Record<string, unknown>): PlaybookDraft {
  const resources = Array.isArray(body.resources) ? body.resources.filter((item): item is PlaybookDraft["resources"][number] => item === "definite_dozen" || item === "playbook" || item === "definite_dozen_ad") : [];
  const permitted = Array.isArray(body.permittedActions) ? body.permittedActions.filter((item): item is PlaybookSendAction => item === "send_asset" || item === "send_video") : [];
  return {
    campaignId: typeof body.campaignId === "string" ? body.campaignId : "",
    name: typeof body.name === "string" ? body.name : "",
    audience: typeof body.audience === "string" ? body.audience : "",
    offerLabel: typeof body.offerLabel === "string" ? body.offerLabel : null,
    offerKey: typeof body.offerKey === "string" ? body.offerKey : null,
    resources,
    manualResource: typeof body.manualResource === "string" ? body.manualResource : null,
    personalVideoId: typeof body.personalVideoId === "string" ? body.personalVideoId : null,
    permittedActions: permitted,
    replyGuidance: typeof body.replyGuidance === "string" ? body.replyGuidance : null,
    fulfillment: (typeof body.fulfillment === "string" ? body.fulfillment : "none") as PlaybookFulfillment,
  };
}

export async function GET() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await listCampaignPlaybooks();
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "The playbook could not be read." }, { status: 422 });
  const intent = body.intent;
  const result = intent === "pause" || intent === "resume" || intent === "retire"
    ? await setCampaignPlaybookStatus({
        campaignId: typeof body.campaignId === "string" ? body.campaignId : "",
        status: intent === "resume" ? "current" : intent === "pause" ? "paused" : "retired",
      })
    : await saveCampaignPlaybook(draftFrom(body));
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}

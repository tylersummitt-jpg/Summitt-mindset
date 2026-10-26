import { NextResponse } from "next/server";

import type { EmailKnowledgeCategory, EmailKnowledgeScope } from "@/lib/acquisition/email-knowledge";
import { approveReusableKnowledge } from "@/lib/acquisition/email-knowledge.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const result = await approveReusableKnowledge({
    sourceRequestId: id,
    draft: {
      topic: typeof body?.topic === "string" ? body.topic : "",
      statement: typeof body?.statement === "string" ? body.statement : "",
      category: (typeof body?.category === "string" ? body.category : "") as EmailKnowledgeCategory,
      scope: (typeof body?.scope === "string" ? body.scope : "") as EmailKnowledgeScope,
      campaignId: typeof body?.campaignId === "string" ? body.campaignId : null,
      offerKey: typeof body?.offerKey === "string" ? body.offerKey : null,
      explicitApproval: body?.explicitApproval === true,
    },
  });
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}

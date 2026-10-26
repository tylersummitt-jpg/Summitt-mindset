import { NextResponse } from "next/server";

import { reviewOwnerEmailAnswer } from "@/lib/acquisition/email-manual-answer";
import { saveEmailAnswer } from "@/lib/acquisition/email-manual-answer.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as { approvedBody?: unknown } | null;
  const approvedBody = reviewOwnerEmailAnswer(typeof body?.approvedBody === "string" ? body.approvedBody : null);
  if (!approvedBody) {
    return NextResponse.json({ ok: false, error: "Write the answer in plain text, without a link or an attachment." }, { status: 422 });
  }
  const result = await saveEmailAnswer({ requestId: id, approvedBody });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, approvedBody });
}

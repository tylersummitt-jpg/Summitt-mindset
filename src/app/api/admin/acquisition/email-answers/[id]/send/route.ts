import { NextResponse } from "next/server";

import { sendApprovedEmailAnswer } from "@/lib/acquisition/email-manual-answer.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const result = await sendApprovedEmailAnswer(id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, providerMessageId: result.providerMessageId });
}

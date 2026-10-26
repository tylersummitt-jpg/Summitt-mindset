import { NextResponse } from "next/server";

import { listEmailAnswers } from "@/lib/acquisition/email-manual-answer.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const rows = await listEmailAnswers();
  return NextResponse.json({ ok: true, rows }, { headers: { "Cache-Control": "no-store" } });
}

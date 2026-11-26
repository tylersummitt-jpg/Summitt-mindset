import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { runAutomaticScheduledGeneration } from "@/lib/tto-scheduled-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled proactive generation.
 * Evening 5:00–9:59 AM America/New_York. Morning 4:00–8:59 PM America/New_York.
 * The five-minute schedule resumes unfinished work. It does not send SMS.
 */
export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await runAutomaticScheduledGeneration();
  return NextResponse.json(result.body, { status: result.status });
}

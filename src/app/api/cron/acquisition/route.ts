import { NextResponse } from "next/server";

import { refreshInstantlySenderSignals, runAcquisitionCron } from "@/lib/acquisition/store";
import { validateCronSecretRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!validateCronSecretRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runAcquisitionCron();
  let senders = 0;
  try {
    senders = (await refreshInstantlySenderSignals()).read;
  } catch (err) {
    console.error("[acquisition] sender read failed", {
      reason: err instanceof Error ? err.message : "read_failed",
    });
  }
  return NextResponse.json({ ...result, senderSignals: senders });
}

export async function POST(request: Request) {
  return GET(request);
}

import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { kickInboundMediaPipeline } from "@/lib/victory-media/kick-inbound-media-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recovery wake for durable Victory Media MMS jobs.
 * Fast path remains Twilio inbound after(); this cron only calls the
 * existing bounded pipeline once.
 */
export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await kickInboundMediaPipeline();
    const summary = {
      wake_source: "cron_victory_media" as const,
      b1Attempted: result.b1Attempted,
      b1Succeeded: result.b1Succeeded,
      b2Attempted: result.b2Attempted,
      b2Succeeded: result.b2Succeeded,
      normalized: result.normalized,
      c1Attempted: result.c1Attempted,
      c2Attempted: result.c2Attempted,
      c2Succeeded: result.c2Succeeded,
      attached: result.attached,
      d2aAttempted: result.d2aAttempted,
      d2aClaimed: result.d2aClaimed,
    };
    console.info("[victory-media/cron] kick done", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[victory-media/cron] kick failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "pipeline_failed" }, { status: 500 });
  }
}

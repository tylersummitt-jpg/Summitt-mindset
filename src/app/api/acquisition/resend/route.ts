import { NextResponse } from "next/server";

import { applyAcquisitionResendEvent } from "@/lib/acquisition/store";
import { interpretResendRecoveryEvent, verifyResendWebhook } from "@/lib/recovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.ACQUISITION_RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Warm email monitoring is not connected." }, { status: 503 });
  const body = await request.text();
  const verified = verifyResendWebhook({
    secret,
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signatureHeader: request.headers.get("svix-signature") ?? "",
    body,
    nowMs: Date.now(),
  });
  if (!verified) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const event = interpretResendRecoveryEvent(payload);
  const stored = event.kind === "delivered"
    ? await applyAcquisitionResendEvent({ kind: "delivered", providerMessageId: event.providerMessageId })
    : event.kind === "suppress"
      ? await applyAcquisitionResendEvent({
        kind: "suppress",
        providerMessageId: event.providerMessageId,
        email: event.email,
        reason: event.reason,
      })
      : true;
  if (stored === false) return NextResponse.json({ error: "Not stored." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

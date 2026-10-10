import { NextResponse } from "next/server";
import { Resend } from "resend";

import {
  interpretResendRecoveryEvent,
  RECOVERY_REPLY_TO,
  shouldForwardRecoveryReply,
  verifyResendWebhook,
} from "@/lib/recovery-engine";
import { applyRecoveryWebhook } from "@/lib/recovery.server";

export async function POST(request: Request) {
  const secret = process.env.RECOVERY_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Reply monitoring is not connected." }, { status: 503 });
  }
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
  if (event.kind === "received") {
    const mail = await readReceivedMail(event.emailId);
    if (!mail) return NextResponse.json({ error: "Received mail could not be read." }, { status: 503 });
    const applied = await applyRecoveryWebhook(event, mail);
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 500 });
    if (applied.forward && shouldForwardRecoveryReply([...event.to, ...mail.to])) {
      await forwardReplyToTyler(event.emailId);
    }
    return NextResponse.json({ ok: true, classification: applied.classification });
  }
  const applied = await applyRecoveryWebhook(event);
  if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function readReceivedMail(emailId: string): Promise<{
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  messageId: string | null;
  to: string[];
} | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const result = await new Resend(key).emails.receiving.get(emailId);
    if (result.error || !result.data) return null;
    return {
      text: result.data.text,
      html: result.data.html,
      headers: result.data.headers,
      messageId: result.data.message_id,
      to: result.data.to ?? [],
    };
  } catch {
    return null;
  }
}

async function forwardReplyToTyler(emailId: string): Promise<void> {
  const domain = process.env.RECOVERY_INBOUND_DOMAIN?.trim().toLowerCase() ?? "";
  const key = process.env.RESEND_API_KEY;
  if (!key || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain === "summittmindset.com") return;
  try {
    await new Resend(key).emails.receiving.forward({
      emailId,
      to: RECOVERY_REPLY_TO,
      from: `inbound@${domain}`,
      passthrough: true,
    });
  } catch {
    console.warn("[recovery] reply was stored and the inbox forward did not complete");
  }
}

import { NextResponse } from "next/server";

import { secretHeaderMatches } from "@/lib/acquisition/model";
import { applyInstantlyWebhook } from "@/lib/acquisition/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET ?? null;
  if (!secret) return NextResponse.json({ error: "Instantly webhook is not connected." }, { status: 503 });
  const header = request.headers.get("x-instantly-webhook-secret");
  if (!secretHeaderMatches(header, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const applied = await applyInstantlyWebhook(payload);
  if (!applied.ok) return NextResponse.json({ error: "Not stored." }, { status: 500 });
  return NextResponse.json({ ok: true, duplicate: applied.duplicate === true });
}

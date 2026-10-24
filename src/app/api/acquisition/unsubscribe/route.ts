import { NextResponse } from "next/server";

import { unsubscribeAcquisition } from "@/lib/acquisition/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribe(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token)) {
    return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });
  }
  const result = await unsubscribeAcquisition(token);
  if (result === "unknown") {
    return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, blockStored: result === "done" });
}

export async function GET(request: Request) {
  return unsubscribe(request);
}

export async function POST(request: Request) {
  return unsubscribe(request);
}

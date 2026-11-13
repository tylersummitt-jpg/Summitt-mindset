import { NextRequest, NextResponse } from "next/server";

import { saveAdLabExperiment, saveAdLabNote } from "@/lib/ad-lab-product";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await requireTylerAdmin();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That form could not be read." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "That form could not be read." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (record.kind === "note") {
    const metaAdId = typeof record.metaAdId === "string" ? record.metaAdId : "";
    const notes = record.notes && typeof record.notes === "object" ? (record.notes as Record<string, unknown>) : {};
    const saved = await saveAdLabNote(metaAdId, notes);
    return NextResponse.json(saved, { status: saved.ok ? 200 : 400 });
  }
  if (record.kind === "experiment") {
    const saved = await saveAdLabExperiment(record);
    return NextResponse.json(saved, { status: saved.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "Unknown save." }, { status: 400 });
}

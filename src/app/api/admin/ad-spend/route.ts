import { NextRequest, NextResponse } from "next/server";

import {
  deleteAdSpend,
  upsertAdSpend,
  validateAdSpendInput,
} from "@/lib/admin-ad-spend";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await requireTylerAdmin();

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = validateAdSpendInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const row = await upsertAdSpend(parsed);
  if (!row) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, row });
}

export async function DELETE(req: NextRequest) {
  await requireTylerAdmin();

  let id = new URL(req.url).searchParams.get("id");
  if (!id) {
    try {
      const body = (await req.json()) as { id?: string };
      id = typeof body?.id === "string" ? body.id : null;
    } catch {
      id = null;
    }
  }
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
  }
  const ok = await deleteAdSpend(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

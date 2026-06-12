import { NextResponse } from "next/server";

import {
  ADMIN_CUSTOMERS_PAGE_SIZE,
  loadAdminCustomersPage,
} from "@/lib/admin-customers-dashboard";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function GET(req: Request) {
  try {
    await requireTylerAdmin();

    const url = new URL(req.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const limit = Math.min(
      parsePositiveInt(url.searchParams.get("limit"), ADMIN_CUSTOMERS_PAGE_SIZE),
      100
    );

    const result = await loadAdminCustomersPage({ page, limit });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error("[admin/customers] GET failed", err);

    const status =
      err != null &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;

    const message =
      err instanceof Error ? err.message : "unknown_error";

    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

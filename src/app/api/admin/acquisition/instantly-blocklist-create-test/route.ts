import { NextResponse } from "next/server";

import { runOwnedBlocklistCreateTest } from "@/lib/acquisition/instantly-blocklist-create-test.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

/**
 * Temporary owner-only create test. Remove this route and
 * src/lib/acquisition/instantly-blocklist-create-test.ts after the one approved POST.
 * The body cannot choose the provider URL or a second address.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const report = await runOwnedBlocklistCreateTest(body);
  return NextResponse.json(report);
}

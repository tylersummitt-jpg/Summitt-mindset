import { NextResponse } from "next/server";

import { readInstantlyBlocklistDiagnostic } from "@/lib/acquisition/instantly-blocklist-read";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

/**
 * Temporary owner diagnostic. Remove this route and
 * src/lib/acquisition/instantly-blocklist-read.ts after the one production read.
 * GET only. Query parameters are ignored. This route does not write to Instantly.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await readInstantlyBlocklistDiagnostic({
    apiKey: process.env.INSTANTLY_API_KEY ?? null,
  });
  return NextResponse.json(report);
}

import { NextResponse } from "next/server";

import { readInstantlyReceivedEmailDiagnostic } from "@/lib/acquisition/instantly-email-read";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

/**
 * Temporary owner diagnostic. Remove this route and
 * src/lib/acquisition/instantly-email-read.ts after the one production read.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await readInstantlyReceivedEmailDiagnostic({
    apiKey: process.env.INSTANTLY_API_KEY ?? null,
  });
  return NextResponse.json(report);
}

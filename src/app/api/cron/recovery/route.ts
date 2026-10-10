import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { runRecoveryCron } from "@/lib/recovery.server";

export async function GET(request: Request) {
  if (!validateCronSecretRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRecoveryCron();
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return GET(request);
}

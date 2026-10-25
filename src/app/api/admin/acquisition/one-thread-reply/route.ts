import { NextResponse } from "next/server";

import { sendAuthorizedOneThreadReply } from "@/lib/acquisition/one-thread-reply.server";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendAuthorizedOneThreadReply();
  return NextResponse.json(result);
}

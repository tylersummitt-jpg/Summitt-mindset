import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { correctReservedCheckoutEmail } from "@/lib/stripe-first-checkout/email-correction";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  try {
    const result = await correctReservedCheckoutEmail({
      clerkUserId: userId,
      nextEmail: email,
    });
    const headers = { "Cache-Control": "no-store" };
    if (result.status === "updated") {
      return NextResponse.json({ status: "updated" }, { headers });
    }
    if (result.status === "taken") {
      return NextResponse.json({ error: "taken" }, { status: 409, headers });
    }
    if (result.status === "stripe_retry") {
      return NextResponse.json({ error: "stripe_retry" }, { status: 503, headers });
    }
    if (result.status === "rejected") {
      return NextResponse.json({ error: "rejected" }, { status: 400, headers });
    }
    return NextResponse.json({ error: "retry" }, { status: 503, headers });
  } catch (err) {
    console.error("[stripe-first] email correction failed", {
      reason: err instanceof Error ? err.message : "email_failed",
    });
    return NextResponse.json({ error: "retry" }, { status: 503 });
  }
}

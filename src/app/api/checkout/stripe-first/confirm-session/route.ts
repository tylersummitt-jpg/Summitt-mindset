import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { confirmHostedSession } from "@/lib/stripe-first-checkout/activate";
import { CHECKOUT_BINDING_COOKIE } from "@/lib/stripe-first-checkout/constants";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const bindingSecret = jar.get(CHECKOUT_BINDING_COOKIE)?.value;
  if (!hostedCompletionBrowserPresent(bindingSecret)) {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await confirmHostedSession({ bindingSecret, clerkUserId: userId });
  const headers = { "Cache-Control": "no-store" };
  if (result.status === "rejected") {
    return NextResponse.json({ error: "rejected" }, { status: 403, headers });
  }
  if (result.status === "retry") {
    return NextResponse.json({ error: "retry" }, { status: 503, headers });
  }
  return NextResponse.json({ status: result.status, next: result.next }, { headers });
}

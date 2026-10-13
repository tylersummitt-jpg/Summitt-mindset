import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getClerkIdentity } from "@/lib/stripe-first-checkout/clerk-provision";
import { linkExistingHostedCheckout } from "@/lib/stripe-first-checkout/activate";
import {
  CHECKOUT_BINDING_COOKIE,
  HOSTED_TEST_ACCESS_COOKIE,
} from "@/lib/stripe-first-checkout/constants";
import {
  hostedCheckoutCredentialModeFromEnv,
  hostedCheckoutRequestAuthorized,
} from "@/lib/stripe-first-checkout/credentials";
import { normalizeCheckoutEmail } from "@/lib/stripe-first-checkout/email-typo";

export const runtime = "nodejs";

export async function POST() {
  if (hostedCheckoutCredentialModeFromEnv() !== "test") {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const jar = await cookies();
  if (!hostedCheckoutRequestAuthorized(jar.get(HOSTED_TEST_ACCESS_COOKIE)?.value)) {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const identity = await getClerkIdentity(userId);
  const email = normalizeCheckoutEmail(identity?.primaryEmail ?? "");
  if (!email) return NextResponse.json({ error: "rejected" }, { status: 403 });

  const result = await linkExistingHostedCheckout({
    bindingSecret: jar.get(CHECKOUT_BINDING_COOKIE)?.value ?? "",
    clerkUserId: userId,
    signedInEmail: email,
  });
  const headers = { "Cache-Control": "no-store" };
  if (result.status === "rejected") {
    return NextResponse.json({ error: "rejected" }, { status: 403, headers });
  }
  if (result.status === "retry") {
    return NextResponse.json({ error: "retry" }, { status: 503, headers });
  }
  return NextResponse.json({ status: result.status, next: result.next }, { headers });
}

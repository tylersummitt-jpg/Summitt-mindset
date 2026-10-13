import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { activateHostedCheckout } from "@/lib/stripe-first-checkout/activate";
import {
  CHECKOUT_BINDING_COOKIE,
  HOSTED_TEST_CONTINUE_PATH,
} from "@/lib/stripe-first-checkout/constants";
import {
  hostedCheckoutCredentialModeFromEnv,
  hostedCompletionBrowserPresent,
} from "@/lib/stripe-first-checkout/credentials";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const bindingSecret = jar.get(CHECKOUT_BINDING_COOKIE)?.value;
  if (!hostedCompletionBrowserPresent(bindingSecret)) {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const result = await activateHostedCheckout({
    sessionId,
    bindingSecret,
  });

  const headers = { "Cache-Control": "no-store" };
  if (result.status === "rejected") {
    return NextResponse.json({ error: "rejected" }, { status: 403, headers });
  }
  if (result.status === "retry") {
    return NextResponse.json({ error: "retry" }, { status: 503, headers });
  }
  if (result.status === "sign_in_required") {
    if (hostedCheckoutCredentialModeFromEnv() !== "test") {
      return NextResponse.json({ error: "rejected" }, { status: 403, headers });
    }
    return NextResponse.json(
      {
        status: "sign_in_required",
        signInUrl: signInUrlPreservingInternalRedirect(HOSTED_TEST_CONTINUE_PATH),
      },
      { headers }
    );
  }
  if (result.status === "ticket") {
    return NextResponse.json({ status: "ticket", ticket: result.ticket }, { headers });
  }
  return NextResponse.json({ status: result.status }, { headers });
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isNativeSummittMindsetApp } from "@/lib/native-app/platform";
import { SM_VISITOR_COOKIE } from "@/lib/marketing-attribution-pure";
import {
  parseProudTestAssignment,
  PROUD_TEST_COOKIE,
} from "@/lib/landing-experiment-shared";
import { hostedTestAccessIsValid } from "@/lib/stripe-first-checkout/access-token";
import { beginHostedCheckout } from "@/lib/stripe-first-checkout/activate";
import {
  BINDING_MAX_AGE_SECONDS,
  CHECKOUT_BINDING_COOKIE,
  HOSTED_TEST_ACCESS_COOKIE,
} from "@/lib/stripe-first-checkout/constants";
import { hostedCheckoutCredentialModeFromEnv } from "@/lib/stripe-first-checkout/credentials";

export const runtime = "nodejs";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function POST(req: Request) {
  if (hostedCheckoutCredentialModeFromEnv() !== "test") {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  if (isNativeSummittMindsetApp(req.headers.get("user-agent"))) {
    return NextResponse.json({ error: "native_app_checkout_unavailable" }, { status: 403 });
  }

  const jar = await cookies();
  const allowed = hostedTestAccessIsValid(
    jar.get(HOSTED_TEST_ACCESS_COOKIE)?.value,
    process.env.CLERK_SECRET_KEY ?? "",
    Date.now()
  );
  if (!allowed) return NextResponse.json({ error: "refused" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = body?.plan === "annual" ? "annual" : body?.plan === "monthly" ? "monthly" : null;
  if (!plan) return NextResponse.json({ error: "plan_required" }, { status: 400 });

  const assignment = parseProudTestAssignment(jar.get(PROUD_TEST_COOKIE)?.value);
  try {
    const started = await beginHostedCheckout({
      request: req,
      plan,
      visitorCookie: jar.get(SM_VISITOR_COOKIE)?.value ?? null,
      experimentId: assignment?.experimentId ?? null,
      experimentVariant: assignment?.variant ?? null,
    });
    const response = NextResponse.json(
      { url: started.url },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set(
      CHECKOUT_BINDING_COOKIE,
      started.bindingSecret,
      cookieOptions(BINDING_MAX_AGE_SECONDS)
    );
    return response;
  } catch (err) {
    console.error("[stripe-first] start failed", {
      reason: err instanceof Error ? err.message : "start_failed",
    });
    return NextResponse.json({ error: "retry" }, { status: 503 });
  }
}

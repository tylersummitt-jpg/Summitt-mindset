import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { trackStripeFirstCheckoutOpened } from "@/lib/checkout-tracking-record.server";
import {
  parseProudTestAssignment,
  PROUD_TEST_COOKIE,
} from "@/lib/landing-experiment-shared";
import { readMarketingCookiesFromRequest } from "@/lib/marketing-collect";
import { SM_VISITOR_COOKIE } from "@/lib/marketing-attribution-pure";
import { isNativeSummittMindsetApp } from "@/lib/native-app/platform";
import { beginHostedCheckout } from "@/lib/stripe-first-checkout/activate";
import {
  BINDING_MAX_AGE_SECONDS,
  CHECKOUT_BINDING_COOKIE,
} from "@/lib/stripe-first-checkout/constants";

export const runtime = "nodejs";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: BINDING_MAX_AGE_SECONDS,
  };
}

export async function POST(req: Request) {
  if (isNativeSummittMindsetApp(req.headers.get("user-agent"))) {
    return NextResponse.json({ error: "native_app_checkout_unavailable" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = body?.plan === "annual" ? "annual" : body?.plan === "monthly" ? "monthly" : null;
  if (!plan) return NextResponse.json({ error: "plan_required" }, { status: 400 });

  const jar = await cookies();
  const assignment = parseProudTestAssignment(jar.get(PROUD_TEST_COOKIE)?.value);
  const marketing = await readMarketingCookiesFromRequest(req).catch(() => null);
  try {
    const started = await beginHostedCheckout({
      request: req,
      plan,
      publicCheckout: true,
      visitorCookie: jar.get(SM_VISITOR_COOKIE)?.value ?? marketing?.visitorId ?? null,
      experimentId: assignment?.experimentId ?? null,
      experimentVariant: assignment?.variant ?? null,
      attribution: marketing?.attribution
        ? {
            utmSource: marketing.attribution.utm_source,
            utmMedium: marketing.attribution.utm_medium,
            utmCampaign: marketing.attribution.utm_campaign,
            utmContent: marketing.attribution.utm_content,
            sourceNormalized: marketing.attribution.source_normalized,
          }
        : undefined,
    });
    await trackStripeFirstCheckoutOpened({
      req,
      plan,
      sessionId: started.sessionId,
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
      cookieOptions()
    );
    return response;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "start_failed";
    console.error("[stripe-first] public start failed", { reason });
    return NextResponse.json({ error: "retry" }, { status: 503 });
  }
}

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  deliverActivateResponse,
  withActivateTrace,
} from "@/lib/stripe-first-checkout/activate-trace";
import {
  activateHostedCheckout,
  checkoutContinueHttpResult,
} from "@/lib/stripe-first-checkout/activate";
import {
  CHECKOUT_BINDING_COOKIE,
  PUBLIC_CHECKOUT_CONTINUE_PATH,
} from "@/lib/stripe-first-checkout/constants";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";
import { noteActivateRetry } from "@/lib/stripe-first-checkout/signup-diagnostics";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withActivateTrace((traceId) => activatePost(req, traceId));
}

async function activatePost(req: Request, traceId: string) {
  const jar = await cookies();
  const bindingSecret = jar.get(CHECKOUT_BINDING_COOKIE)?.value;
  if (!hostedCompletionBrowserPresent(bindingSecret)) {
    return deliverActivateResponse({
      traceId,
      category: "refused",
      error: "refused",
      response: NextResponse.json({ error: "refused" }, { status: 404 }),
    });
  }
  const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const result = await activateHostedCheckout({ sessionId, bindingSecret });

  const headers = { "Cache-Control": "no-store" };
  if (result.status === "rejected") {
    return deliverActivateResponse({
      traceId,
      category: "rejected",
      error: "rejected",
      response: NextResponse.json({ error: "rejected" }, { status: 403, headers }),
    });
  }
  if (result.status === "retry") {
    await noteActivateRetry(bindingSecret);
    return deliverActivateResponse({
      traceId,
      category: "retry",
      error: "retry",
      response: NextResponse.json({ error: "retry" }, { status: 503, headers }),
    });
  }
  if (result.status === "sign_in_required") {
    return deliverActivateResponse({
      traceId,
      category: "sign_in_required",
      response: NextResponse.json(
        {
          status: "sign_in_required",
          signInUrl: signInUrlPreservingInternalRedirect(PUBLIC_CHECKOUT_CONTINUE_PATH),
        },
        { headers }
      ),
    });
  }
  if (result.status === "ticket") {
    return deliverActivateResponse({
      traceId,
      category: "ticket",
      response: NextResponse.json({ status: "ticket", ticket: result.ticket }, { headers }),
    });
  }
  if (result.status === "preserved") {
    return deliverActivateResponse({
      traceId,
      category: "preserved",
      response: NextResponse.json({ status: "preserved", next: "/post-sign-in" }, { headers }),
    });
  }
  if (result.status === "continue") {
    const { userId } = await auth();
    const resume = await checkoutContinueHttpResult({
      bindingSecret,
      authenticatedClerkUserId: userId ?? null,
    });
    const category = "status" in resume.body ? resume.body.status : resume.body.error;
    const error = "error" in resume.body ? resume.body.error : undefined;
    return deliverActivateResponse({
      traceId,
      category,
      error,
      response: NextResponse.json(resume.body, { status: resume.http, headers }),
    });
  }
  return deliverActivateResponse({
    traceId,
    category: result.status,
    response: NextResponse.json({ status: result.status }, { headers }),
  });
}

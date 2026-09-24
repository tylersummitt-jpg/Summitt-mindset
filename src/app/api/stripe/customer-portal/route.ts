import { NextResponse } from "next/server";
import Stripe from "stripe";
import { auth, currentUser } from "@clerk/nextjs/server";

import { resolveStripeCheckoutReturnOrigin } from "@/lib/stripe-checkout-return-origin";

export const runtime = "nodejs";

/**
 * Restricted Stripe Customer Portal session: payment-method update only.
 * In-app /cancel remains the only cancellation path. This route must not
 * open plan changes, pause, invoices, or subscription cancel.
 */

const CLIENT_OVERRIDE_KEYS = [
  "customer",
  "customerId",
  "customer_id",
  "stripeCustomerId",
  "stripe_customer_id",
  "return_url",
  "returnUrl",
  "success_url",
  "cancel_url",
  "flow_data",
] as const;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function clerkStripeCustomerId(metadata: unknown): string | null {
  if (metadata == null || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).stripeCustomerId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function queryAttemptsOverride(req: Request): boolean {
  const url = new URL(req.url);
  return CLIENT_OVERRIDE_KEYS.some((key) => url.searchParams.has(key));
}

async function bodyAttemptsOverride(req: Request): Promise<boolean | "malformed"> {
  const text = await req.text();
  if (text.trim() === "") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "malformed";
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "malformed";
  }
  const record = parsed as Record<string, unknown>;
  return CLIENT_OVERRIDE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function isStripePortalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (queryAttemptsOverride(req)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const bodyOverride = await bodyAttemptsOverride(req);
  if (bodyOverride === "malformed" || bodyOverride) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const user = await currentUser();
  if (!user) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const stripeCustomerId = clerkStripeCustomerId(user.publicMetadata);
  if (!stripeCustomerId) {
    return json({ ok: false, error: "no_stripe_customer" }, 404);
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("[customer-portal] Missing STRIPE_SECRET_KEY");
    return json({ ok: false, error: "stripe_unavailable" }, 500);
  }

  const stripe = new Stripe(stripeSecretKey);

  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(stripeCustomerId);
  } catch (err) {
    console.error("[customer-portal] Stripe customer retrieve failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, error: "no_stripe_customer" }, 404);
  }

  if (
    customer == null ||
    typeof customer !== "object" ||
    customer.deleted === true ||
    typeof customer.id !== "string" ||
    customer.id !== stripeCustomerId
  ) {
    return json({ ok: false, error: "no_stripe_customer" }, 404);
  }

  const metadataUserId = customer.metadata?.userId;
  if (typeof metadataUserId !== "string" || metadataUserId.trim() !== userId) {
    console.warn("[customer-portal] ownership_mismatch", { userId });
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const returnUrl = `${resolveStripeCheckoutReturnOrigin(req)}/user`;

  let session: Stripe.BillingPortal.Session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
      flow_data: {
        type: "payment_method_update",
        after_completion: {
          type: "redirect",
          redirect: { return_url: returnUrl },
        },
      },
    });
  } catch (err) {
    console.error("[customer-portal] portal session create failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, error: "stripe_unavailable" }, 502);
  }

  if (!isStripePortalUrl(session?.url)) {
    console.error("[customer-portal] portal session URL rejected", { userId });
    return json({ ok: false, error: "stripe_unavailable" }, 502);
  }

  return json({ ok: true, url: session.url }, 200);
}

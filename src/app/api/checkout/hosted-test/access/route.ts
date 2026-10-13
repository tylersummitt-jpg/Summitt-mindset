import { NextResponse } from "next/server";

import { isTylerAdminSession, isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { signHostedTestAccess } from "@/lib/stripe-first-checkout/access-token";
import {
  ACCESS_MAX_AGE_SECONDS,
  CANARY_ACCESS_MAX_AGE_SECONDS,
  HOSTED_TEST_ACCESS_COOKIE,
} from "@/lib/stripe-first-checkout/constants";
import { hostedCheckoutCredentialModeFromEnv } from "@/lib/stripe-first-checkout/credentials";

export const runtime = "nodejs";

function cookieOptions(maxAge: number, canary: boolean) {
  return {
    httpOnly: true,
    secure: canary || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function POST() {
  const mode = hostedCheckoutCredentialModeFromEnv();
  if (mode !== "test" && mode !== "canary") {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const owner = mode === "canary" ? await isTylerOwnerSession() : await isTylerAdminSession();
  if (!owner) {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const maxAge = mode === "canary" ? CANARY_ACCESS_MAX_AGE_SECONDS : ACCESS_MAX_AGE_SECONDS;
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  const token = signHostedTestAccess(Date.now() + maxAge * 1000, secret);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set(HOSTED_TEST_ACCESS_COOKIE, token, cookieOptions(maxAge, mode === "canary"));
  return response;
}

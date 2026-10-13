import { NextResponse } from "next/server";

import { isTylerAdminSession } from "@/lib/auth/require-tyler-admin";
import { signHostedTestAccess } from "@/lib/stripe-first-checkout/access-token";
import {
  ACCESS_MAX_AGE_SECONDS,
  HOSTED_TEST_ACCESS_COOKIE,
} from "@/lib/stripe-first-checkout/constants";
import { hostedCheckoutCredentialModeFromEnv } from "@/lib/stripe-first-checkout/credentials";

export const runtime = "nodejs";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  };
}

export async function POST() {
  if (hostedCheckoutCredentialModeFromEnv() !== "test") {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  if (!(await isTylerAdminSession())) {
    return NextResponse.json({ error: "refused" }, { status: 404 });
  }
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  const token = signHostedTestAccess(Date.now() + ACCESS_MAX_AGE_SECONDS * 1000, secret);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set(HOSTED_TEST_ACCESS_COOKIE, token, cookieOptions());
  return response;
}

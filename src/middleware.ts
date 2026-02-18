// src/middleware.ts

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * ======================================================
 * Clerk Middleware — Twilio Safe Public Routes
 * ======================================================
 *
 * Public:
 * - Marketing pages
 * - Policies
 * - Subscribe
 * - Twilio verification
 * - Auth pages
 * - Webhooks
 */

const isPublicRoute = createRouteMatcher([
  "/",
  "/privacy",
  "/terms",
  "/sms",
  "/twilio",
  "/subscribe(.*)",

  // Clerk auth pages should always be public
  "/sign-in(.*)",
  "/sign-up(.*)",

  // Webhooks must be public
  "/api/webhooks(.*)",
  "/api/stripe/webhook(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { userId } = await auth();

  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};

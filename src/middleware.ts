// src/middleware.ts

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * ======================================================
 * Clerk Middleware — Twilio-Safe + Version Compatible
 * ======================================================
 *
 * Your Clerk version does NOT support:
 * - clerkMiddleware({ publicRoutes })
 * - auth().protect()
 *
 * So we implement the classic pattern:
 * - Allow public routes
 * - For everything else:
 *   - if not signed in -> redirect to /sign-in
 *
 * This guarantees Twilio can access public pages.
 */

const isPublicRoute = createRouteMatcher([
  "/",
  "/privacy",
  "/terms",
  "/sms",
  "/twilio",

  // Clerk auth pages should always be public
  "/sign-in(.*)",
  "/sign-up(.*)",

  // Webhooks must be public
  "/api/webhooks(.*)",
  "/api/stripe/webhook(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Allow Twilio + public visitors to see these pages without auth
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // For all other routes: require signed-in user
  const { userId } = await auth();

  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run Clerk middleware on all routes except static files and Next internals
    "/((?!_next|.*\\..*).*)",
  ],
};

// src/middleware.ts

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * ======================================================
 * Clerk Middleware — Public Routes (CANONICAL)
 * ======================================================
 *
 * Public (no Clerk session required):
 * - Marketing pages + policies
 * - Auth pages
 * - Webhooks (Stripe, etc.)
 * - Twilio (verification + incoming webhooks)
 * - Cron jobs (Vercel cron -> our server auth, not Clerk)
 *
 * NOTE:
 * Cron + Twilio must be public because they are server-to-server calls.
 * We secure them inside the route with secrets/signatures.
 */

const isPublicRoute = createRouteMatcher([
  // Marketing / policies
  "/",
  "/privacy",
  "/terms",
  "/data-deletion",
  "/sms",
  "/twilio",
  "/subscribe(.*)",
  "/daily-practice",
  "/ask-pat-preview",
  "/film-room-preview",
  "/about",
  "/pat-summitt-quotes",
  "/pat-summitt-quotes/(.*)",
  "/pat-summitt-leadership",
  "/pat-summitt-leadership-principles",
  "/pat-summitt-discipline",
  "/pat-summitt-accountability",
  "/pat-summitt-team-culture",
  "/pat-summitt-best-quotes",
  "/pat-summitt-documentary",
  "/pat-xo-documentary",
  "/the-cinderella-season-documentary",
  "/pat-summitt-espn-documentary",
  "/pat-summitt-hulu-documentary",
  "/pat-summitt-discipline-quotes",
  "/pat-summitt-accountability-quotes",
  "/pat-summitt-teamwork-quotes",
  "/pat-summitt-leadership-quotes",
  "/pat-summitt-leadership-challenge",
  "/challenge(.*)",
  "/pulse",

  // Clerk auth pages should always be public
  "/sign-in(.*)",
  "/sign-up(.*)",

  // Webhooks must be public
  "/api/webhooks(.*)",
  "/api/stripe/webhook(.*)",

  // Challenge signup (anonymous email capture)
  "/api/challenge/signup",

  // Pulse flow (SMS users open /pulse?t=... and POST to pulse-reply without session)
  "/api/sms/pulse-reply",

  // ✅ Cron routes must be public (secured by CRON_SECRET inside handler)
  "/api/cron(.*)",

  // ✅ Twilio routes must be public (secured by Twilio signature inside handler)
  "/api/twilio(.*)",
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
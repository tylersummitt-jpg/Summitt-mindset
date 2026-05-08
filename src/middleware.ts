// src/middleware.ts

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  COACH_ATTRIBUTION_COOKIE_NAME,
  COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
  isCoachAttributionEnabled,
  isCoachAttributionPath,
} from "@/lib/coach-attribution";

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
  "/coach-leadership-kit(.*)",
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
  const shouldSetCoachAttributionCookie =
    isCoachAttributionEnabled() && isCoachAttributionPath(req.nextUrl.pathname);

  if (isPublicRoute(req)) {
    const res = NextResponse.next();
    if (shouldSetCoachAttributionCookie) {
      res.cookies.set(COACH_ATTRIBUTION_COOKIE_NAME, COACH_ATTRIBUTION_COOKIE_VALUE_COACH, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false,
      });
    }
    return res;
  }

  const { userId } = await auth();

  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    const res = NextResponse.redirect(signInUrl);
    if (shouldSetCoachAttributionCookie) {
      res.cookies.set(COACH_ATTRIBUTION_COOKIE_NAME, COACH_ATTRIBUTION_COOKIE_VALUE_COACH, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false,
      });
    }
    return res;
  }

  const res = NextResponse.next();
  if (shouldSetCoachAttributionCookie) {
    res.cookies.set(COACH_ATTRIBUTION_COOKIE_NAME, COACH_ATTRIBUTION_COOKIE_VALUE_COACH, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
    });
  }
  return res;
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
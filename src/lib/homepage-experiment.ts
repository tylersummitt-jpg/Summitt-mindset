import { NextRequest, NextResponse } from "next/server";

import { COACH_ATTRIBUTION_COOKIE_NAME } from "@/lib/coach-attribution";
import {
  recordLandingAssignment,
  readProudTestStatus,
} from "@/lib/landing-experiment-assign";
import {
  decideHomepageSplit,
  isPrefetchRequest,
  parseLandingAssignments,
  PROUD_TEST_COOKIE,
  PROUD_TEST_EXPERIMENT_ID,
  upsertLandingAssignment,
} from "@/lib/landing-experiment-shared";
import {
  marketingCookieOptions,
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  SM_ACQ_COOKIE,
  SM_VISITOR_COOKIE,
} from "@/lib/marketing-attribution-pure";
import { isNativeSummittMindsetApp } from "@/lib/native-app/platform";

/**
 * Assigns an eligible anonymous visitor who opens /.
 * Control renders in place. Challenger redirects before the homepage is sent.
 * Returns null when this request should keep the normal homepage path.
 */
export async function applyHomepageExperiment(
  req: NextRequest,
  args: { signedIn: boolean }
): Promise<NextResponse | null> {
  try {
    if (req.nextUrl.pathname !== "/") return null;
    if (req.method !== "GET" && req.method !== "HEAD") return null;
    const nativeApp = isNativeSummittMindsetApp(req.headers.get("user-agent"));
    if (args.signedIn || nativeApp) return null;

    const existing = parseLandingAssignments(req.cookies.get(PROUD_TEST_COOKIE)?.value).find(
      (assignment) => assignment.experimentId === PROUD_TEST_EXPERIMENT_ID
    );
    if (existing?.variant === "control") return null;
    const resolved = resolveMarketingCookies({
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      referrer: req.headers.get("referer"),
      coachCookie: req.cookies.get(COACH_ATTRIBUTION_COOKIE_NAME)?.value ?? null,
      existingVisitor: req.cookies.get(SM_VISITOR_COOKIE)?.value ?? null,
      existingAcqRaw: req.cookies.get(SM_ACQ_COOKIE)?.value ?? null,
      nowIso: new Date().toISOString(),
      generatedVisitorId: crypto.randomUUID(),
    });
    const decision = decideHomepageSplit({
      signedIn: false,
      nativeApp: false,
      status: await readProudTestStatus(),
      visitorId: resolved?.visitorId ?? null,
      existingVariant: existing?.variant ?? null,
      userAgent: req.headers.get("user-agent"),
      prefetch: isPrefetchRequest(req.headers),
    });
    if (decision.action === "ignore" || !resolved || !decision.variant) return null;

    const response =
      decision.action === "redirect"
        ? NextResponse.redirect(assignedUrl(req, decision.destination), 302)
        : NextResponse.next();
    response.headers.set("cache-control", "private, no-store");
    const cookieOptions = marketingCookieOptions(process.env.NODE_ENV === "production");
    response.cookies.set(SM_VISITOR_COOKIE, resolved.visitorId, cookieOptions);
    response.cookies.set(SM_ACQ_COOKIE, serializeAcquisitionCookie(resolved.payload), cookieOptions);
    response.cookies.set(
      PROUD_TEST_COOKIE,
      upsertLandingAssignment(req.cookies.get(PROUD_TEST_COOKIE)?.value, {
        experimentId: PROUD_TEST_EXPERIMENT_ID,
        variant: decision.variant,
        path: decision.destination,
      }),
      { ...cookieOptions, httpOnly: false }
    );
    if (decision.created) {
      await recordLandingAssignment({
        visitorId: resolved.visitorId,
        experimentId: PROUD_TEST_EXPERIMENT_ID,
        slug: "proud-test",
        variant: decision.variant,
        attribution: resolved.payload,
        userAgent: req.headers.get("user-agent"),
        synthetic: req.headers.get("x-sm-exp-probe") === "1",
        entryMode: "homepage",
      }).catch(() => undefined);
    }
    return response;
  } catch (err) {
    console.warn("[homepage-experiment] split skipped", {
      reason: err instanceof Error ? err.message : "homepage_split_failed",
    });
    return null;
  }
}

function assignedUrl(req: NextRequest, destination: string): URL {
  const url = req.nextUrl.clone();
  url.pathname = destination;
  return url;
}

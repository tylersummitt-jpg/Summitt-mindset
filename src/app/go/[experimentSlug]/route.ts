import { NextRequest, NextResponse } from "next/server";

import { COACH_ATTRIBUTION_COOKIE_NAME } from "@/lib/coach-attribution";
import {
  decideLandingEntry,
  isPrefetchRequest,
  parseEntrySlug,
  parseLandingAssignments,
  PROUD_TEST_COOKIE,
  upsertLandingAssignment,
} from "@/lib/landing-experiment";
import { readLandingExperimentBySlug } from "@/lib/landing-experiment.server";
import {
  marketingCookieOptions,
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  SM_ACQ_COOKIE,
  SM_VISITOR_COOKIE,
} from "@/lib/marketing-attribution-pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assigns eligible visitors for one registry experiment and redirects to that
 * experiment's approved page. It does not record an exposure, and it never
 * redirects to a URL supplied by the request.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ experimentSlug: string }> }
) {
  const { experimentSlug } = await context.params;
  const slug = parseEntrySlug(experimentSlug);
  const experiment = slug
    ? await readLandingExperimentBySlug(slug).catch(() => "unavailable" as const)
    : "missing";
  const row = experiment === "missing" || experiment === "unavailable" ? null : experiment;
  const existing = parseLandingAssignments(req.cookies.get(PROUD_TEST_COOKIE)?.value).find(
    (assignment) => assignment.experimentId === row?.id
  );
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
  const decision = decideLandingEntry({
    experimentId: row?.id ?? "missing",
    status: experiment === "unavailable" ? "unavailable" : (row?.status ?? "missing"),
    visitorId: resolved?.visitorId ?? null,
    existingVariant: existing?.variant ?? null,
    destinations: row?.destinations ?? null,
    userAgent: req.headers.get("user-agent"),
    prefetch: isPrefetchRequest(req.headers),
  });
  const response = NextResponse.redirect(new URL(decision.destination, req.url), 302);
  response.headers.set("cache-control", "no-store");
  const cookieOptions = marketingCookieOptions(process.env.NODE_ENV === "production");
  if (resolved) {
    response.cookies.set(SM_VISITOR_COOKIE, resolved.visitorId, cookieOptions);
    response.cookies.set(
      SM_ACQ_COOKIE,
      serializeAcquisitionCookie(resolved.payload),
      cookieOptions
    );
  }
  if (decision.created && decision.variant && row) {
    response.cookies.set(
      PROUD_TEST_COOKIE,
      upsertLandingAssignment(req.cookies.get(PROUD_TEST_COOKIE)?.value, {
        experimentId: row.id,
        variant: decision.variant,
        path: decision.destination,
      }),
      { ...cookieOptions, httpOnly: false }
    );
  }
  return response;
}

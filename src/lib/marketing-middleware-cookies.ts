/**
 * Cookie-only marketing first-touch. Safe for middleware.
 * No database, no fetch, no analytics I/O.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { COACH_ATTRIBUTION_COOKIE_NAME } from "@/lib/coach-attribution";
import {
  isVisitorId,
  marketingCookieOptions,
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  SM_ACQ_COOKIE,
  SM_VISITOR_COOKIE,
} from "@/lib/marketing-attribution-pure";
import { isPersonalVideoWatchPath } from "@/lib/personal-videos/analytics";
import { isNativeSummittMindsetApp } from "@/lib/native-app/platform";

export function attachMarketingCookies(
  req: NextRequest,
  res: NextResponse
): NextResponse {
  try {
    if (isNativeSummittMindsetApp(req.headers.get("user-agent"))) {
      return res;
    }
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
    if (!resolved) return attachPersonalVideoVisitorCookie(req, res);
    const opts = marketingCookieOptions(process.env.NODE_ENV === "production");
    res.cookies.set(SM_VISITOR_COOKIE, resolved.visitorId, opts);
    res.cookies.set(
      SM_ACQ_COOKIE,
      serializeAcquisitionCookie(resolved.payload),
      opts
    );
    return attachPersonalVideoVisitorCookie(req, res);
  } catch {
    return res;
  }
}

/** Mint sm_visitor for a personal-video page. Does not read or write sm_acq. */
export function attachPersonalVideoVisitorCookie(req: NextRequest, res: NextResponse): NextResponse {
  try {
    if (isNativeSummittMindsetApp(req.headers.get("user-agent"))) return res;
    if (!isPersonalVideoWatchPath(req.nextUrl.pathname)) return res;
    const existing = req.cookies.get(SM_VISITOR_COOKIE)?.value ?? null;
    if (isVisitorId(existing)) return res;
    const visitorId = crypto.randomUUID();
    if (!isVisitorId(visitorId)) return res;
    res.cookies.set(
      SM_VISITOR_COOKIE,
      visitorId,
      marketingCookieOptions(process.env.NODE_ENV === "production")
    );
    return res;
  } catch {
    return res;
  }
}

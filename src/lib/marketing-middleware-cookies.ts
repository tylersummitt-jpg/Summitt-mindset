/**
 * Cookie-only marketing first-touch. Safe for middleware.
 * No database, no fetch, no analytics I/O.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { COACH_ATTRIBUTION_COOKIE_NAME } from "@/lib/coach-attribution";
import {
  marketingCookieOptions,
  resolveMarketingCookies,
  serializeAcquisitionCookie,
  SM_ACQ_COOKIE,
  SM_VISITOR_COOKIE,
} from "@/lib/marketing-attribution-pure";
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
    if (!resolved) return res;
    const opts = marketingCookieOptions(process.env.NODE_ENV === "production");
    res.cookies.set(SM_VISITOR_COOKIE, resolved.visitorId, opts);
    res.cookies.set(
      SM_ACQ_COOKIE,
      serializeAcquisitionCookie(resolved.payload),
      opts
    );
    return res;
  } catch {
    return res;
  }
}

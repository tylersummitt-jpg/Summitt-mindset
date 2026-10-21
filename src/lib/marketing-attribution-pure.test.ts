import { describe, expect, it } from "vitest";

import {
  attributionMatchesDashboardSource,
  isAcquisitionIdentityPath,
  isBrowserSignUpPath,
  isMarketingPageViewPath,
  isPureDirectTouch,
  isTrialAcquisitionHref,
  isVisitorId,
  mergeFirstTouch,
  normalizeAcquisition,
  parseAcquisitionCookie,
  readAcquisitionCookieFromRequest,
  resolveMarketingCookies,
  selectGoogleClickId,
  serializeAcquisitionCookie,
  marketingCookieOptions,
  type AcquisitionCookiePayload,
} from "@/lib/marketing-attribution-pure";

function touch(partial: Parameters<typeof normalizeAcquisition>[0]) {
  return normalizeAcquisition(partial);
}

describe("marketing route allowlist", () => {
  it("allows homepage, previews, subscribe, coach kit, pat pages, challenge", () => {
    expect(isMarketingPageViewPath("/")).toBe(true);
    expect(isMarketingPageViewPath("/about")).toBe(true);
    expect(isMarketingPageViewPath("/daily-practice")).toBe(true);
    expect(isMarketingPageViewPath("/ask-pat-preview")).toBe(true);
    expect(isMarketingPageViewPath("/film-room-preview")).toBe(true);
    expect(isMarketingPageViewPath("/subscribe")).toBe(true);
    expect(isMarketingPageViewPath("/coach-leadership-kit/how-it-works")).toBe(true);
    expect(isMarketingPageViewPath("/pat-summitt-quotes/leadership")).toBe(true);
    expect(isMarketingPageViewPath("/challenge/day/1")).toBe(true);
  });

  it("excludes auth, member, admin, policies, subscribe success", () => {
    expect(isMarketingPageViewPath("/subscribe/success")).toBe(false);
    expect(isMarketingPageViewPath("/sign-in")).toBe(false);
    expect(isMarketingPageViewPath("/sign-up")).toBe(false);
    expect(isMarketingPageViewPath("/sign-up/sso-callback")).toBe(false);
    expect(isMarketingPageViewPath("/app/sign-in")).toBe(false);
    expect(isMarketingPageViewPath("/onboarding/identity")).toBe(false);
    expect(isMarketingPageViewPath("/dashboard/victory-room")).toBe(false);
    expect(isMarketingPageViewPath("/ask-pat")).toBe(false);
    expect(isMarketingPageViewPath("/film-room")).toBe(false);
    expect(isMarketingPageViewPath("/user")).toBe(false);
    expect(isMarketingPageViewPath("/admin/subscriber-growth")).toBe(false);
    expect(isMarketingPageViewPath("/internal/sms-qa")).toBe(false);
    expect(isMarketingPageViewPath("/post-sign-in")).toBe(false);
    expect(isMarketingPageViewPath("/pulse")).toBe(false);
    expect(isMarketingPageViewPath("/winback")).toBe(false);
    expect(isMarketingPageViewPath("/cancel")).toBe(false);
    expect(isMarketingPageViewPath("/privacy")).toBe(false);
    expect(isMarketingPageViewPath("/terms")).toBe(false);
    expect(isMarketingPageViewPath("/sms")).toBe(false);
    expect(isMarketingPageViewPath("/app/membership")).toBe(false);
  });
});

describe("source normalization precedence", () => {
  it("maps coach cookie and coach path to referral + source_detail=coach + unpaid", () => {
    const fromCookie = touch({ coachCookie: "coach" });
    expect(fromCookie.source_normalized).toBe("referral");
    expect(fromCookie.source_detail).toBe("coach");
    expect(fromCookie.is_paid_acquisition).toBe(false);

    const fromPath = touch({ pathname: "/coach-leadership-kit" });
    expect(fromPath.source_normalized).toBe("referral");
    expect(fromPath.source_detail).toBe("coach");
    expect(fromPath.is_paid_acquisition).toBe(false);
  });

  it("maps paid Meta via fbclid and facebook UTMs", () => {
    const fbclid = touch({ fbclid: "abc" });
    expect(fbclid.source_normalized).toBe("meta");
    expect(fbclid.is_paid_acquisition).toBe(true);
    expect(fbclid.fbclid_present).toBe(true);

    const utm = touch({ utm_source: "facebook", utm_medium: "paid", utm_campaign: "spring", utm_content: "ad1" });
    expect(utm.source_normalized).toBe("meta");
    expect(utm.is_paid_acquisition).toBe(true);
    expect(utm.utm_campaign).toBe("spring");
    expect(utm.utm_content).toBe("ad1");
  });

  it("maps Facebook/Instagram source without paid markers to organic social", () => {
    const organic = touch({ utm_source: "facebook", utm_medium: "social" });
    expect(organic.source_normalized).toBe("organic_social");
    expect(organic.is_paid_acquisition).toBe(false);
  });

  it("maps paid Google via gclid and google cpc", () => {
    const gclid = touch({ gclid: "xyz" });
    expect(gclid.source_normalized).toBe("google");
    expect(gclid.is_paid_acquisition).toBe(true);
    expect(gclid.gclid_present).toBe(true);

    const cpc = touch({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" });
    expect(cpc.source_normalized).toBe("google");
    expect(cpc.is_paid_acquisition).toBe(true);
    expect(cpc.utm_campaign).toBe("brand");
  });

  it("maps organic social referrers without paid markers", () => {
    const ig = touch({ referrer: "https://www.instagram.com/reel/123" });
    expect(ig.source_normalized).toBe("organic_social");
    expect(ig.is_paid_acquisition).toBe(false);
    expect(ig.referrer_host).toBe("instagram.com");
  });

  it("maps Google organic referrer as google unpaid", () => {
    const organic = touch({ referrer: "https://www.google.com/search?q=summitt" });
    expect(organic.source_normalized).toBe("google");
    expect(organic.is_paid_acquisition).toBe(false);
  });

  it("maps other external referrer as referral", () => {
    const ref = touch({ referrer: "https://news.example.com/story" });
    expect(ref.source_normalized).toBe("referral");
    expect(ref.is_paid_acquisition).toBe(false);
    expect(ref.referrer_host).toBe("news.example.com");
  });

  it("maps empty to direct", () => {
    const direct = touch({});
    expect(direct.source_normalized).toBe("direct");
    expect(direct.is_paid_acquisition).toBe(false);
    expect(isPureDirectTouch(direct)).toBe(true);
  });

  it("does not treat same-site referrer as external", () => {
    const self = touch({ referrer: "https://summittmindset.com/about" });
    expect(self.source_normalized).toBe("direct");
    expect(self.referrer_host).toBeNull();
  });

  it("coach wins over later Meta UTMs on the same hit", () => {
    const both = touch({
      pathname: "/coach-leadership-kit",
      utm_source: "facebook",
      fbclid: "abc",
    });
    expect(both.source_normalized).toBe("referral");
    expect(both.source_detail).toBe("coach");
    expect(both.is_paid_acquisition).toBe(false);
  });
});

describe("first-touch merge", () => {
  const now = "2026-09-01T12:00:00.000Z";

  it("creates first touch when none exists", () => {
    const merged = mergeFirstTouch(null, touch({ utm_source: "google", utm_medium: "cpc" }), now);
    expect(merged.source_normalized).toBe("google");
    expect(merged.first_touch_at).toBe(now);
  });

  it("does not mint cookies for excluded routes", () => {
    expect(
      resolveMarketingCookies({
        pathname: "/sign-in",
        nowIso: now,
        generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
      })
    ).toBeNull();
    expect(
      resolveMarketingCookies({
        pathname: "/app/sign-in",
        nowIso: now,
        generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
      })
    ).toBeNull();
    expect(
      resolveMarketingCookies({
        pathname: "/checkout/start",
        nowIso: now,
        generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
      })
    ).toBeNull();
    expect(
      resolveMarketingCookies({
        pathname: "/admin/subscriber-growth",
        nowIso: now,
        generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
      })
    ).toBeNull();
  });

  it("mints visitor + first-touch Direct on homepage", () => {
    const resolved = resolveMarketingCookies({
      pathname: "/",
      nowIso: now,
      generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
    });
    expect(resolved?.visitorId).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
    expect(resolved?.payload.source_normalized).toBe("direct");
    expect(resolved?.payload.is_paid_acquisition).toBe(false);
  });

  it("never overwrites a meaningful first touch", () => {
    const first = mergeFirstTouch(null, touch({ utm_source: "google", utm_medium: "cpc" }), now);
    const later = mergeFirstTouch(first, touch({ fbclid: "meta" }), "2026-09-02T12:00:00.000Z");
    expect(later.source_normalized).toBe("google");
    expect(later.is_paid_acquisition).toBe(true);
    expect(later.first_touch_at).toBe(now);
  });

  it("allows pure Direct to upgrade before account link", () => {
    const direct = mergeFirstTouch(null, touch({}), now);
    const upgraded = mergeFirstTouch(
      direct,
      touch({ utm_source: "facebook", utm_medium: "paid", utm_campaign: "q4" }),
      "2026-09-03T00:00:00.000Z"
    );
    expect(upgraded.source_normalized).toBe("meta");
    expect(upgraded.utm_campaign).toBe("q4");
  });

  it("does not upgrade Direct when incoming is still Direct", () => {
    const direct = mergeFirstTouch(null, touch({}), now);
    const still = mergeFirstTouch(direct, touch({}), "2026-09-04T00:00:00.000Z");
    expect(still.source_normalized).toBe("direct");
    expect(still.first_touch_at).toBe(now);
  });

  it("captures real fbclid without changing a Google first-touch source", () => {
    const first = mergeFirstTouch(
      null,
      touch({ utm_source: "google", utm_medium: "cpc" }),
      now
    );
    const resolved = resolveMarketingCookies({
      pathname: "/",
      search: "fbclid=AbCdEf123",
      existingVisitor: "3b241101-e2bb-4255-8caf-4136c566a962",
      existingAcqRaw: serializeAcquisitionCookie(first),
      nowIso: "2026-09-02T12:00:00.000Z",
      generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
    });
    expect(resolved?.payload.source_normalized).toBe("google");
    expect(resolved?.payload.is_paid_acquisition).toBe(true);
    expect(resolved?.payload.meta_fbclid).toBe("AbCdEf123");
    expect(resolved?.payload.meta_fbclid_observed_at).toBe("2026-09-02T12:00:00.000Z");
  });

  it("keeps the first observed fbclid timestamp on later requests", () => {
    const first = resolveMarketingCookies({
      pathname: "/",
      search: "fbclid=FirstClickId",
      nowIso: now,
      generatedVisitorId: "3b241101-e2bb-4255-8caf-4136c566a962",
    });
    const later = resolveMarketingCookies({
      pathname: "/",
      search: "fbclid=SecondClickId",
      existingVisitor: first?.visitorId,
      existingAcqRaw: serializeAcquisitionCookie(first!.payload),
      nowIso: "2026-09-08T12:00:00.000Z",
      generatedVisitorId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(later?.payload.meta_fbclid).toBe("FirstClickId");
    expect(later?.payload.meta_fbclid_observed_at).toBe(now);
    expect(later?.payload.source_normalized).toBe("meta");
  });

  it("round-trips cookie JSON without PII fields", () => {
    const payload: AcquisitionCookiePayload = mergeFirstTouch(
      null,
      touch({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand", utm_content: "ad-a" }),
      now
    );
    const raw = serializeAcquisitionCookie(payload);
    const parsed = parseAcquisitionCookie(raw);
    expect(parsed).toEqual(payload);
    expect(JSON.stringify(parsed)).not.toMatch(/@/);
    expect(JSON.stringify(parsed)).not.toMatch(/email/i);
    expect(JSON.stringify(parsed)).not.toMatch(/phone/i);
  });
});

describe("acquisition identity vs page-view eligibility", () => {
  const now = "2026-09-01T12:00:00.000Z";
  const visitorId = "3b241101-e2bb-4255-8caf-4136c566a962";

  it("keeps /sign-up out of Unique Website Visitors page views", () => {
    expect(isMarketingPageViewPath("/sign-up")).toBe(false);
    expect(isMarketingPageViewPath("/sign-up/sso-callback")).toBe(false);
    expect(isBrowserSignUpPath("/sign-up")).toBe(true);
    expect(isBrowserSignUpPath("/sign-up/sso-callback")).toBe(true);
    expect(isAcquisitionIdentityPath("/sign-up")).toBe(true);
    expect(isAcquisitionIdentityPath("/sign-up/sso-callback")).toBe(true);
  });

  it("keeps existing marketing pages eligible for identity and page view", () => {
    expect(isMarketingPageViewPath("/")).toBe(true);
    expect(isAcquisitionIdentityPath("/")).toBe(true);
    expect(isBrowserSignUpPath("/")).toBe(false);
  });

  it("does not treat sign-in or direct checkout as acquisition identity", () => {
    expect(isAcquisitionIdentityPath("/sign-in")).toBe(false);
    expect(isAcquisitionIdentityPath("/app/sign-in")).toBe(false);
    expect(isAcquisitionIdentityPath("/checkout/start")).toBe(false);
    expect(isBrowserSignUpPath("/sign-in")).toBe(false);
    expect(isBrowserSignUpPath("/app/sign-in")).toBe(false);
    expect(isBrowserSignUpPath("/checkout/start")).toBe(false);
  });

  it("mints existing visitor + acq cookies on /sign-up when missing", () => {
    const resolved = resolveMarketingCookies({
      pathname: "/sign-up",
      nowIso: now,
      generatedVisitorId: visitorId,
    });
    expect(resolved?.visitorId).toBe(visitorId);
    expect(resolved?.payload.source_normalized).toBe("direct");
  });

  it("mints existing visitor + acq cookies on nested Clerk signup when missing", () => {
    const resolved = resolveMarketingCookies({
      pathname: "/sign-up/sso-callback",
      nowIso: now,
      generatedVisitorId: visitorId,
    });
    expect(resolved?.visitorId).toBe(visitorId);
    expect(resolved?.payload.source_normalized).toBe("direct");
  });
});

describe("cookie flags", () => {
  it("uses HttpOnly, SameSite Lax, 90-day lifetime", () => {
    const opts = marketingCookieOptions(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(true);
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(90 * 24 * 60 * 60);
    expect(marketingCookieOptions(false).secure).toBe(false);
  });
});

describe("trial CTA href detection", () => {
  it("counts subscribe and sign-up-to-subscribe, not sign-in or native", () => {
    expect(isTrialAcquisitionHref("/subscribe")).toBe(true);
    expect(isTrialAcquisitionHref("/checkout/start")).toBe(true);
    expect(isTrialAcquisitionHref("/subscribe?from=home")).toBe(true);
    expect(isTrialAcquisitionHref(`/sign-up?redirect_url=${encodeURIComponent("/subscribe")}`)).toBe(
      true
    );
    expect(isTrialAcquisitionHref(`/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`)).toBe(
      true
    );
    expect(isTrialAcquisitionHref("/sign-up?redirect_url=/subscribe")).toBe(true);
    expect(isTrialAcquisitionHref("/sign-up?redirect_url=/checkout/start")).toBe(true);
    expect(
      isTrialAcquisitionHref(`/sign-up?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`)
    ).toBe(true);
    expect(isTrialAcquisitionHref("/sign-in")).toBe(false);
    expect(isTrialAcquisitionHref("/app/sign-in")).toBe(false);
    expect(isTrialAcquisitionHref("/app/membership")).toBe(false);
    expect(isTrialAcquisitionHref("/subscribe/success")).toBe(false);
    expect(isTrialAcquisitionHref("/dashboard/victory-room")).toBe(false);
  });
});

describe("Google click identifiers", () => {
  const now = "2026-09-01T12:00:00.000Z";
  const later = "2026-09-08T12:00:00.000Z";
  const visitor = "3b241101-e2bb-4255-8caf-4136c566a962";
  const gclid = "Cj0KCQtestGclid123";
  const wbraid = "WbraidTestClick123";
  const gbraid = "GbraidTestClick123";

  function resolve(args: {
    search?: string;
    referrer?: string;
    pathname?: string;
    coachCookie?: string;
    existing?: AcquisitionCookiePayload | null;
    nowIso?: string;
  }) {
    return resolveMarketingCookies({
      pathname: args.pathname ?? "/",
      search: args.search,
      referrer: args.referrer,
      coachCookie: args.coachCookie,
      existingVisitor: args.existing ? visitor : undefined,
      existingAcqRaw: args.existing ? serializeAcquisitionCookie(args.existing) : null,
      nowIso: args.nowIso ?? now,
      generatedVisitorId: visitor,
    });
  }

  it("classifies a gclid visit as paid Google and stores that id", () => {
    const resolved = resolve({ search: `gclid=${gclid}` });
    expect(resolved?.payload.source_normalized).toBe("google");
    expect(resolved?.payload.is_paid_acquisition).toBe(true);
    expect(resolved?.payload.gclid_present).toBe(true);
    expect(resolved?.payload.google_click_id_type).toBe("gclid");
    expect(resolved?.payload.google_click_id).toBe(gclid);
  });

  it("recognizes wbraid and gbraid, and keeps gclid when all three are present", () => {
    const fromWbraid = resolve({ search: `wbraid=${wbraid}` });
    expect(fromWbraid?.payload.source_normalized).toBe("google");
    expect(fromWbraid?.payload.is_paid_acquisition).toBe(true);
    expect(fromWbraid?.payload.gclid_present).toBe(false);
    expect(fromWbraid?.payload.google_click_id_type).toBe("wbraid");
    expect(fromWbraid?.payload.google_click_id).toBe(wbraid);

    const fromGbraid = resolve({ search: `gbraid=${gbraid}` });
    expect(fromGbraid?.payload.google_click_id_type).toBe("gbraid");
    expect(fromGbraid?.payload.google_click_id).toBe(gbraid);
    expect(fromGbraid?.payload.is_paid_acquisition).toBe(true);

    expect(selectGoogleClickId({ gclid, wbraid, gbraid })).toEqual({
      type: "gclid",
      value: gclid,
    });
    const allThree = resolve({
      search: `gclid=${gclid}&wbraid=${wbraid}&gbraid=${gbraid}`,
    });
    expect(allThree?.payload.google_click_id_type).toBe("gclid");
    expect(allThree?.payload.google_click_id).toBe(gclid);
  });

  it("keeps Google organic search unpaid and without a click id", () => {
    const organic = resolve({ referrer: "https://www.google.com/search?q=summitt" });
    expect(organic?.payload.source_normalized).toBe("google");
    expect(organic?.payload.is_paid_acquisition).toBe(false);
    expect(organic?.payload.google_click_id).toBeNull();
    expect(organic?.payload.google_click_id_type).toBeNull();

    const blank = resolve({ search: "wbraid=%20&gbraid=" });
    expect(blank?.payload.source_normalized).toBe("direct");
    expect(blank?.payload.google_click_id).toBeNull();
  });

  it("does not let a later Google click replace Meta, coach, or organic first touch", () => {
    const both = resolve({ search: `fbclid=AbCdEf123&gclid=${gclid}` });
    expect(both?.payload.source_normalized).toBe("meta");
    expect(both?.payload.fbclid_present).toBe(true);
    expect(both?.payload.gclid_present).toBe(true);
    expect(both?.payload.google_click_id).toBeNull();

    const meta = resolve({ search: "fbclid=AbCdEf123" });
    const afterMeta = resolve({
      search: `gclid=${gclid}`,
      existing: meta?.payload,
      nowIso: later,
    });
    expect(afterMeta?.payload.source_normalized).toBe("meta");
    expect(afterMeta?.payload.is_paid_acquisition).toBe(true);
    expect(afterMeta?.payload.first_touch_at).toBe(now);
    expect(afterMeta?.payload.google_click_id).toBeNull();

    const coach = resolve({
      pathname: "/coach-leadership-kit",
      search: `gclid=${gclid}`,
    });
    expect(coach?.payload.source_normalized).toBe("referral");
    expect(coach?.payload.source_detail).toBe("coach");
    expect(coach?.payload.google_click_id).toBeNull();
    const afterCoach = resolve({
      search: `wbraid=${wbraid}`,
      existing: coach?.payload,
      nowIso: later,
    });
    expect(afterCoach?.payload.source_detail).toBe("coach");
    expect(afterCoach?.payload.google_click_id).toBeNull();

    const organic = resolve({ referrer: "https://www.google.com/search?q=summitt" });
    const afterOrganic = resolve({
      search: `gclid=${gclid}`,
      existing: organic?.payload,
      nowIso: later,
    });
    expect(afterOrganic?.payload.is_paid_acquisition).toBe(false);
    expect(afterOrganic?.payload.google_click_id).toBeNull();
  });

  it("keeps the first paid-Google id when the same browser returns with another", () => {
    const first = resolve({ search: `gclid=${gclid}` });
    const repeat = resolve({
      search: `gclid=${gclid}&wbraid=${wbraid}`,
      existing: first?.payload,
      nowIso: later,
    });
    expect(repeat?.payload.google_click_id).toBe(gclid);
    expect(repeat?.payload.google_click_id_type).toBe("gclid");
    expect(repeat?.payload.first_touch_at).toBe(now);

    const replaced = resolve({
      search: `gclid=${wbraid}`,
      existing: first?.payload,
      nowIso: later,
    });
    expect(replaced?.payload.google_click_id).toBe(gclid);
    expect(replaced?.payload.source_normalized).toBe("google");
  });

  it("stores the id when Direct upgrades to paid Google and not onto an older paid-Google cookie", () => {
    const direct = resolve({});
    expect(direct?.payload.source_normalized).toBe("direct");
    const upgraded = resolve({
      search: `wbraid=${wbraid}`,
      existing: direct?.payload,
      nowIso: later,
    });
    expect(upgraded?.payload.source_normalized).toBe("google");
    expect(upgraded?.payload.is_paid_acquisition).toBe(true);
    expect(upgraded?.payload.google_click_id_type).toBe("wbraid");
    expect(upgraded?.payload.google_click_id).toBe(wbraid);
    expect(upgraded?.payload.first_touch_at).toBe(later);

    const utmOnly = resolve({ search: "utm_source=google&utm_medium=cpc&utm_campaign=brand" });
    expect(utmOnly?.payload.is_paid_acquisition).toBe(true);
    expect(utmOnly?.payload.google_click_id).toBeNull();
    const stillEmpty = resolve({
      search: `gclid=${gclid}`,
      existing: utmOnly?.payload,
      nowIso: later,
    });
    expect(stillEmpty?.payload.source_normalized).toBe("google");
    expect(stillEmpty?.payload.google_click_id).toBeNull();
    expect(stillEmpty?.payload.first_touch_at).toBe(now);
  });

  it("parses a version-1 cookie from before click ids existed", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        v: 1,
        first_touch_at: now,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "brand",
        utm_content: null,
        gclid_present: true,
        fbclid_present: false,
        referrer_host: null,
        source_normalized: "google",
        is_paid_acquisition: true,
        source_detail: null,
        meta_fbclid: null,
        meta_fbclid_observed_at: null,
      })
    );
    const parsed = parseAcquisitionCookie(raw);
    expect(parsed?.source_normalized).toBe("google");
    expect(parsed?.is_paid_acquisition).toBe(true);
    expect(parsed?.gclid_present).toBe(true);
    expect(parsed?.google_click_id).toBeNull();
    expect(parsed?.google_click_id_type).toBeNull();
    expect(parsed?.v).toBe(1);
  });

  it("drops a planted click id on a cookie that is not paid Google", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        v: 1,
        first_touch_at: now,
        utm_source: "facebook",
        utm_medium: "paid",
        utm_campaign: null,
        utm_content: null,
        gclid_present: false,
        fbclid_present: true,
        referrer_host: null,
        source_normalized: "meta",
        is_paid_acquisition: true,
        source_detail: null,
        meta_fbclid: "AbCdEf123",
        meta_fbclid_observed_at: now,
        google_click_id_type: "gclid",
        google_click_id: gclid,
      })
    );
    const parsed = parseAcquisitionCookie(raw);
    expect(parsed?.source_normalized).toBe("meta");
    expect(parsed?.meta_fbclid).toBe("AbCdEf123");
    expect(parsed?.google_click_id).toBeNull();
    expect(parsed?.google_click_id_type).toBeNull();
  });

  it("reads the click id from a Next.js cookie and from a raw Cookie header", () => {
    const payload = resolve({ search: `gclid=${gclid}` })?.payload;
    const encoded = serializeAcquisitionCookie(payload!);
    const nextRequest = {
      headers: { get: () => null },
      cookies: {
        get: (name: string) => (name === "sm_acq" ? { value: encoded } : undefined),
      },
    } as unknown as Request;
    expect(readAcquisitionCookieFromRequest(nextRequest)?.google_click_id).toBe(gclid);

    const headerRequest = new Request("https://summittmindset.com/", {
      headers: { cookie: `sm_acq=${encoded}` },
    });
    expect(readAcquisitionCookieFromRequest(headerRequest)?.google_click_id).toBe(gclid);
    expect(readAcquisitionCookieFromRequest(headerRequest)?.source_normalized).toBe("google");
  });

  it("rejects an unsafe click id without changing paid-Google classification", () => {
    const resolved = resolve({ search: "gclid=not%20safe" });
    expect(resolved?.payload.source_normalized).toBe("google");
    expect(resolved?.payload.is_paid_acquisition).toBe(true);
    expect(resolved?.payload.gclid_present).toBe(true);
    expect(resolved?.payload.google_click_id).toBeNull();
  });
});

describe("helpers", () => {
  it("validates visitor UUIDs", () => {
    expect(isVisitorId("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true);
    expect(isVisitorId("not-a-uuid")).toBe(false);
  });

  it("maps dashboard Google filter to both paid and organic google rows", () => {
    expect(attributionMatchesDashboardSource("google", "google")).toBe(true);
    expect(attributionMatchesDashboardSource("meta", "google")).toBe(false);
    expect(attributionMatchesDashboardSource("meta", "meta_ads")).toBe(true);
    expect(attributionMatchesDashboardSource("referral", "referral")).toBe(true);
    expect(attributionMatchesDashboardSource("google", "all")).toBe(true);
  });
});

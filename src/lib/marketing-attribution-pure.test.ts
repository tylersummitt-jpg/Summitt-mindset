import { describe, expect, it } from "vitest";

import {
  attributionMatchesDashboardSource,
  isMarketingPageViewPath,
  isPureDirectTouch,
  isTrialAcquisitionHref,
  isVisitorId,
  mergeFirstTouch,
  normalizeAcquisition,
  parseAcquisitionCookie,
  resolveMarketingCookies,
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

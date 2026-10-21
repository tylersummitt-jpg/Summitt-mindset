import { describe, expect, it } from "vitest";

import { googleAdsUploadEligibility } from "@/lib/google-ads/google-ads-eligibility";

const click = { google_click_id_type: "gclid", google_click_id: "EAIaIQobChMI_test" };

describe("Google Ads upload eligibility", () => {
  it("allows a live US checkout with a stored click id", () => {
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: "US", ...click },
      })
    ).toEqual({ ok: true, click: { type: "gclid", value: "EAIaIQobChMI_test" } });
  });

  it("rejects non-US, unknown, and lowercase country values", () => {
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: "DE", ...click },
      }).ok
    ).toBe(false);
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: null, ...click },
      })
    ).toMatchObject({ ok: false, reason: "unknown_country" });
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: "us", ...click },
      })
    ).toMatchObject({ ok: false, reason: "not_us" });
  });

  it("rejects a missing click id, test mode, and an owner canary", () => {
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: "US" },
      })
    ).toMatchObject({ ok: false, reason: "missing_click_id" });
    expect(
      googleAdsUploadEligibility({
        ownerCanary: false,
        subscriptionLivemode: false,
        intent: { livemode: true, request_country: "US", ...click },
      })
    ).toMatchObject({ ok: false, reason: "not_livemode" });
    expect(
      googleAdsUploadEligibility({
        ownerCanary: true,
        subscriptionLivemode: true,
        intent: { livemode: true, request_country: "US", ...click },
      })
    ).toMatchObject({ ok: false, reason: "owner_canary" });
  });
});

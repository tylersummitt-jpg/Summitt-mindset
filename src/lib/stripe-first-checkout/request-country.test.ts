import { describe, expect, it } from "vitest";
import {
  isUsGoogleAdsUploadEligible,
  trustedRequestCountry,
  trustedRequestCountryFromRequest,
} from "@/lib/stripe-first-checkout/request-country";

describe("trusted checkout country", () => {
  it("accepts an exact US code only on the Vercel runtime", () => {
    expect(
      trustedRequestCountry({ vercelRuntime: true, headerValue: "US" })
    ).toBe("US");
    expect(isUsGoogleAdsUploadEligible("US")).toBe(true);
  });

  it("keeps a non-US code and does not treat it as eligible", () => {
    expect(
      trustedRequestCountry({ vercelRuntime: true, headerValue: "DE" })
    ).toBe("DE");
    expect(
      trustedRequestCountry({ vercelRuntime: true, headerValue: " GB " })
    ).toBe("GB");
    expect(isUsGoogleAdsUploadEligible("DE")).toBe(false);
    expect(isUsGoogleAdsUploadEligible("GB")).toBe(false);
  });

  it("treats missing and invalid values as unknown", () => {
    for (const headerValue of [null, "", " ", "us", "USA", "U", "X1"]) {
      expect(trustedRequestCountry({ vercelRuntime: true, headerValue })).toBeNull();
    }
    expect(isUsGoogleAdsUploadEligible(null)).toBe(false);
    expect(isUsGoogleAdsUploadEligible(undefined)).toBe(false);
  });

  it("ignores a client-supplied Vercel header when the runtime is not Vercel", () => {
    expect(
      trustedRequestCountry({ vercelRuntime: false, headerValue: "US" })
    ).toBeNull();
    const request = new Request("https://summittmindset.com/api/checkout/stripe-first/start", {
      method: "POST",
      headers: {
        "x-vercel-ip-country": "US",
        "x-country": "US",
        "cf-ipcountry": "US",
      },
    });
    const previous = process.env.VERCEL;
    delete process.env.VERCEL;
    expect(trustedRequestCountryFromRequest(request)).toBeNull();
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  });
});

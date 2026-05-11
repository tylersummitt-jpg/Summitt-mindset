import { describe, expect, it } from "vitest";
import { isCoachSubscribeRedirectUrl } from "@/lib/safe-redirect";

describe("isCoachSubscribeRedirectUrl", () => {
  it("is true for encoded coach subscribe redirect", () => {
    expect(
      isCoachSubscribeRedirectUrl(
        encodeURIComponent("/subscribe?src=coach")
      )
    ).toBe(true);
  });

  it("is true for raw coach subscribe path", () => {
    expect(isCoachSubscribeRedirectUrl("/subscribe?src=coach")).toBe(true);
  });

  it("is false for generic subscribe", () => {
    expect(isCoachSubscribeRedirectUrl("/subscribe")).toBe(false);
  });

  it("is false for arbitrary path", () => {
    expect(isCoachSubscribeRedirectUrl("/dashboard")).toBe(false);
  });

  it("is false for null", () => {
    expect(isCoachSubscribeRedirectUrl(null)).toBe(false);
  });
});

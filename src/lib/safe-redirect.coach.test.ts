import { describe, expect, it } from "vitest";
import {
  isCoachSubscribeRedirectUrl,
  sanitizeInternalRedirectUrl,
  signInUrlPreservingInternalRedirect,
  signUpUrlPreservingInternalRedirect,
} from "@/lib/safe-redirect";

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

describe("sanitizeInternalRedirectUrl checkout hop", () => {
  it("allows /checkout/start with no query", () => {
    expect(sanitizeInternalRedirectUrl("/checkout/start")).toBe("/checkout/start");
  });

  it("rejects checkout start query strings", () => {
    expect(sanitizeInternalRedirectUrl("/checkout/start?src=coach")).toBeNull();
  });

  it("preserves checkout hop and coach subscribe on auth toggle URLs", () => {
    expect(signUpUrlPreservingInternalRedirect("/checkout/start")).toBe(
      `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signInUrlPreservingInternalRedirect("/checkout/start")).toBe(
      `/sign-in?redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signUpUrlPreservingInternalRedirect("/subscribe?src=coach")).toBe(
      `/sign-up?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`
    );
    expect(signUpUrlPreservingInternalRedirect(null)).toBe("/sign-up");
    expect(signInUrlPreservingInternalRedirect(null)).toBe("/sign-in");
  });
});

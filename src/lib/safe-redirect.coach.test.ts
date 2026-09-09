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

describe("sanitizeInternalRedirectUrl subscribe success session_id", () => {
  it("allows /subscribe/success?session_id=cs_test_abc", () => {
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=cs_test_abc")
    ).toBe("/subscribe/success?session_id=cs_test_abc");
  });

  it("allows encoded /subscribe/success?session_id=cs_test_abc", () => {
    expect(
      sanitizeInternalRedirectUrl(
        encodeURIComponent("/subscribe/success?session_id=cs_test_abc")
      )
    ).toBe("/subscribe/success?session_id=cs_test_abc");
  });

  it("allows live-style cs_ session ids", () => {
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=cs_live_ABC123")
    ).toBe("/subscribe/success?session_id=cs_live_ABC123");
  });

  it("allows bare /subscribe/success", () => {
    expect(sanitizeInternalRedirectUrl("/subscribe/success")).toBe(
      "/subscribe/success"
    );
  });

  it("rejects extra query params", () => {
    expect(
      sanitizeInternalRedirectUrl(
        "/subscribe/success?session_id=cs_test_abc&from=onboarding"
      )
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=cs_test_abc&src=coach")
    ).toBeNull();
  });

  it("rejects empty session_id", () => {
    expect(sanitizeInternalRedirectUrl("/subscribe/success?session_id=")).toBeNull();
    expect(sanitizeInternalRedirectUrl("/subscribe/success?session_id")).toBeNull();
  });

  it("rejects session_id values that are not Stripe checkout ids", () => {
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=https://evil.example")
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=cs_test_abc/../../../etc")
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=not_a_session")
    ).toBeNull();
  });

  it("rejects protocol-relative and open-redirect forms", () => {
    expect(
      sanitizeInternalRedirectUrl("//evil.example/subscribe/success?session_id=cs_test_abc")
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl(
        "https://evil.example/subscribe/success?session_id=cs_test_abc"
      )
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl("/subscribe/success?session_id=//evil.example")
    ).toBeNull();
  });

  it("does not allow session_id on other allowlisted paths", () => {
    expect(
      sanitizeInternalRedirectUrl("/post-sign-in?session_id=cs_test_abc")
    ).toBeNull();
    expect(
      sanitizeInternalRedirectUrl("/checkout/start?session_id=cs_test_abc")
    ).toBeNull();
  });
});

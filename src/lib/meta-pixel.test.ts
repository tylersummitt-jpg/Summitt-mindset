import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMetaPixelId,
  isMetaPixelEnabled,
  sanitizeMetaPayload,
  trackCoachCtaClicked,
  trackCoachInitiateCheckout,
  trackMetaCustom,
  trackMetaStandard,
} from "@/lib/meta-pixel";

describe("getMetaPixelId", () => {
  const original = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    } else {
      process.env.NEXT_PUBLIC_META_PIXEL_ID = original;
    }
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
  });

  it("accepts numeric ID", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";
    expect(getMetaPixelId()).toBe("1234567890");
  });

  it("rejects non-numeric ID", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "abc<script>";
    expect(getMetaPixelId()).toBeNull();
  });

  it("returns null when unset", () => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    expect(getMetaPixelId()).toBeNull();
    expect(isMetaPixelEnabled()).toBe(false);
  });
});

describe("isMetaPixelEnabled", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
  });

  it("respects NEXT_PUBLIC_META_PIXEL_ENABLED=false", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "999";
    process.env.NEXT_PUBLIC_META_PIXEL_ENABLED = "false";
    expect(isMetaPixelEnabled()).toBe(false);
  });
});

describe("sanitizeMetaPayload", () => {
  it("passes safe coach payload", () => {
    expect(
      sanitizeMetaPayload({
        source: "coach",
        funnel: "coach_leadership_kit",
        cta: "hero",
        plan: "monthly",
        status: "success",
        page_path: "/coach-leadership-kit",
      })
    ).toEqual({
      source: "coach",
      funnel: "coach_leadership_kit",
      cta: "hero",
      plan: "monthly",
      status: "success",
      page_path: "/coach-leadership-kit",
    });
  });

  it("drops unknown keys", () => {
    const result = sanitizeMetaPayload({
      source: "coach",
      unknown_key: "x",
    });
    expect(result).toEqual({ source: "coach" });
  });

  it("blocks sensitive keys and values", () => {
    const cases: Record<string, unknown>[] = [
      { email: "a@b.com" },
      { phone: "+15551234567" },
      { identity: "I am a leader" },
      { goal: "run daily" },
      { sms: "hello" },
      { proof: "secret" },
      { session_id: "cs_test" },
      { userId: "user_123" },
      { page_path: "/ok?token=1" },
      { source: "x@y" },
      { source: "a".repeat(65) },
      { source: "cs_live_abc" },
    ];

    for (const payload of cases) {
      expect(sanitizeMetaPayload(payload)).toBeNull();
    }
  });
});

describe("trackMetaStandard / trackMetaCustom", () => {
  const fbq = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", { fbq } as unknown as Window & typeof globalThis);
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
    fbq.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
  });

  it("coach wrappers use same event names and safe payloads", () => {
    trackCoachCtaClicked("hero");
    expect(fbq).toHaveBeenCalledWith("trackCustom", "coach_cta_clicked", {
      source: "coach",
      funnel: "coach_leadership_kit",
      cta: "hero",
    });

    trackCoachInitiateCheckout("annual");
    expect(fbq).toHaveBeenCalledWith("track", "InitiateCheckout", {
      source: "coach",
      funnel: "coach_leadership_kit",
      plan: "annual",
    });
  });

  it("no-ops unsafe standard events", () => {
    trackMetaStandard("PageView", { email: "a@b.com" });
    expect(fbq).not.toHaveBeenCalled();
  });

  it("no-ops unsafe custom events", () => {
    trackMetaCustom("coach_shipping_submitted", {
      source: "coach",
      funnel: "coach_leadership_kit",
      status: "success",
      goal: "hidden",
    });
    expect(fbq).not.toHaveBeenCalled();
  });
});

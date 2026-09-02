import { describe, expect, it } from "vitest";
import { getMetaPageViewDecision } from "@/lib/meta-pixel-route-policy";

describe("getMetaPageViewDecision", () => {
  it("allows marketing routes", () => {
    for (const path of [
      "/",
      "/about",
      "/daily-practice",
      "/subscribe",
      "/coach-leadership-kit",
      "/coach-leadership-kit/how-it-works",
      "/pat-summitt-quotes",
      "/pat-summitt-leadership-principles",
      "/ask-pat-preview",
      "/ask-pat-preview/sample",
      "/film-room-preview",
      "/film-room-preview/clip",
      "/challenge",
      "/challenge/day/1",
      "/sign-in",
      "/sign-up",
    ]) {
      const d = getMetaPageViewDecision(path, "");
      expect(d.action, path).toBe("allow");
    }
  });

  it("allows subscribe with marketing query params", () => {
    const d = getMetaPageViewDecision("/subscribe", "src=coach&canceled=1&from=post-sign-in");
    expect(d.action).toBe("allow");
  });

  it("blocks legal and support pages", () => {
    for (const path of ["/privacy", "/terms", "/sms", "/support", "/data-deletion", "/twilio"]) {
      const d = getMetaPageViewDecision(path, "");
      expect(d.action, path).toBe("block");
    }
  });

  it("blocks sensitive and private routes", () => {
    const blocked: Array<[string, string]> = [
      ["/subscribe/success", "session_id=test"],
      ["/pulse", "t=test"],
      ["/winback", "t=test"],
      ["/dashboard/victory-room", ""],
      ["/onboarding/identity", ""],
      ["/internal/sms-qa", "phone=123"],
      ["/ask-pat", ""],
      ["/film-room", ""],
      ["/coach/setup", ""],
      ["/post-sign-in", ""],
      ["/user", ""],
      ["/admin", ""],
      ["/admin/subscriber-growth", ""],
    ];

    for (const [path, search] of blocked) {
      const d = getMetaPageViewDecision(path, search);
      expect(d.action, `${path}?${search}`).toBe("block");
    }
  });

  it("blocks denylisted query keys on allowed pathnames", () => {
    const d = getMetaPageViewDecision("/subscribe", "session_id=cs_test");
    expect(d.action).toBe("block");
    if (d.action === "block") {
      expect(d.reason).toContain("session_id");
    }
  });

  it("blocks sensitive redirect_url on sign-in", () => {
    const d = getMetaPageViewDecision(
      "/sign-in",
      `redirect_url=${encodeURIComponent("/internal/sms-qa")}`
    );
    expect(d.action).toBe("block");
    if (d.action === "block") {
      expect(d.reason).toBe("sensitive_redirect_url");
    }
  });

  it("blocks unknown routes by default", () => {
    const d = getMetaPageViewDecision("/modules", "");
    expect(d.action).toBe("block");
    if (d.action === "block") {
      expect(d.reason).toBe("unknown_route");
    }
  });
});

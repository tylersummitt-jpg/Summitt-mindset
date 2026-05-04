import { describe, expect, it } from "vitest";
import {
  normalizeIdentityAnchorText,
  validateOnboardingIdentityAnchorInput,
} from "@/lib/v2-identity-anchor-validation";

describe("v2-identity-anchor-validation (client-safe)", () => {
  it("does not resolve supabase-server when importing validation module", async () => {
    const keys = Object.keys(await import("@/lib/v2-identity-anchor-validation"));
    expect(keys.join(" ")).not.toContain("supabase");
    expect(keys).toContain("validateOnboardingIdentityAnchorInput");
  });

  it("validateOnboardingIdentityAnchorInput rejects empty input", () => {
    const r = validateOnboardingIdentityAnchorInput("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("become");
  });

  it("validateOnboardingIdentityAnchorInput rejects too-short phrases", () => {
    const r = validateOnboardingIdentityAnchorInput("short");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("detail");
  });

  it("validateOnboardingIdentityAnchorInput rejects relationship stubs", () => {
    const r = validateOnboardingIdentityAnchorInput("my kids");
    expect(r.ok).toBe(false);
  });

  it("validateOnboardingIdentityAnchorInput accepts a substantive line", () => {
    const r = validateOnboardingIdentityAnchorInput(
      "Someone who follows through on promises to my family every day."
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.length).toBeGreaterThanOrEqual(12);
  });

  it("normalizeIdentityAnchorText truncates very long input", () => {
    const long = "a".repeat(300);
    const n = normalizeIdentityAnchorText(long);
    expect(n).not.toBeNull();
    expect(n!.length).toBeLessThanOrEqual(220);
  });
});

import { describe, expect, it } from "vitest";
import {
  normalizePatternText,
  validateSmsPatternCorrectionInsert,
  SMS_PATTERN_CORRECTION_MAX,
} from "@/lib/sms-pattern-correction-schema";

const base = {
  correction_type: "user_phrase_meaning" as const,
  meaning_label: "done means completed bar",
  correction_summary: "When user says done they mean they completed the daily bar.",
  source: "operator_seed" as const,
  phrase_pattern: "done",
};

describe("sms-pattern-correction-schema", () => {
  it("accepts valid user correction", () => {
    const v = validateSmsPatternCorrectionInsert({
      ...base,
      scope: "user",
      clerk_user_id: "user_abc",
    });
    expect(v.scope).toBe("user");
    expect(v.clerk_user_id).toBe("user_abc");
    expect(v.commitment_id).toBeNull();
    expect(v.status).toBe("suggested");
    expect(v.usage_policy).toBe("prompt_hint_only");
  });

  it("accepts valid commitment correction", () => {
    const v = validateSmsPatternCorrectionInsert({
      ...base,
      scope: "commitment",
      clerk_user_id: "user_abc",
      commitment_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(v.scope).toBe("commitment");
    expect(v.commitment_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("accepts valid global correction", () => {
    const v = validateSmsPatternCorrectionInsert({
      ...base,
      scope: "global",
      phrase_pattern: "tapback thumbs up",
    });
    expect(v.scope).toBe("global");
    expect(v.clerk_user_id).toBeNull();
    expect(v.commitment_id).toBeNull();
  });

  it("rejects invalid scope", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "team" as "user",
        clerk_user_id: "user_abc",
      })
    ).toThrow("scope_invalid");
  });

  it("rejects invalid usage_policy", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
        clerk_user_id: "user_abc",
        usage_policy: "live_routing" as "prompt_hint_only",
      })
    ).toThrow("usage_policy_invalid");
  });

  it("rejects invalid status", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
        clerk_user_id: "user_abc",
        status: "live" as "suggested",
      })
    ).toThrow("status_invalid");
  });

  it("rejects confidence outside 0–1", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
        clerk_user_id: "user_abc",
        confidence: 1.5,
      })
    ).toThrow("confidence_out_of_range");
  });

  it("rejects missing pattern", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
        clerk_user_id: "user_abc",
        phrase_pattern: "   ",
        normalized_pattern: null,
      })
    ).toThrow("pattern_required");
  });

  it("rejects global with clerk_user_id", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "global",
        clerk_user_id: "user_abc",
      })
    ).toThrow("scope_global_forbids_clerk_user_id");
  });

  it("rejects user without clerk_user_id", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
      })
    ).toThrow("scope_user_requires_clerk_user_id");
  });

  it("rejects commitment without commitment_id", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "commitment",
        clerk_user_id: "user_abc",
      })
    ).toThrow("scope_commitment_requires_commitment_id");
  });

  it("normalizes pattern text", () => {
    expect(normalizePatternText("  Done   Today ")).toBe("done today");
  });

  it("enforces max pattern length via normalizePatternText", () => {
    const long = "x".repeat(300);
    const n = normalizePatternText(long);
    expect(n).not.toBeNull();
    expect(n!.length).toBeLessThanOrEqual(SMS_PATTERN_CORRECTION_MAX.normalized_pattern);
  });

  it("rejects non-object metadata", () => {
    expect(() =>
      validateSmsPatternCorrectionInsert({
        ...base,
        scope: "user",
        clerk_user_id: "user_abc",
        metadata: ["bad"] as unknown as Record<string, unknown>,
      })
    ).toThrow("metadata_must_be_object");
  });
});

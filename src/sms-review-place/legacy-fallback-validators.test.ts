import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { isStrategyCardEligible } from "@/lib/coaching-strategy-card-v1";
import { buildInboundFacts } from "@/sms-review-place/build-facts";
import { LEGACY_FALLBACK_TEMPLATE_PREVIEW_STUB } from "@/sms-review-place/fixtures/conversation-brain-fallback-scenarios";
import { getScenarioById } from "@/sms-review-place/fixtures/scenarios";
import {
  assertLegacyFallbackFinalGuardRan,
  assertNoLegacyFallbackTemplatePreviewSpoken,
  assertNoStrategyCardPresentForLegacyFallback,
  assertTuSuppressesLegacyFallback,
} from "@/sms-review-place/legacy-fallback-validators";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sim-invalid.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sim-service-role-key-not-real";
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("legacy fallback validators", () => {
  it("assertNoStrategyCardPresentForLegacyFallback rejects eligible facts", () => {
    const scenario = getScenarioById("legacy-fallback-completion-safe")!;
    const facts = buildInboundFacts(scenario, "Yes");
    expect(isStrategyCardEligible(facts)).toBe(false);
    expect(
      assertNoStrategyCardPresentForLegacyFallback(facts, {}, "humane body", "humane body")
    ).toBeNull();
  });

  it("assertNoLegacyFallbackTemplatePreviewSpoken catches preview substring", () => {
    const scenario = getScenarioById("legacy-fallback-template-preview-non-speakable")!;
    const facts = buildInboundFacts(scenario, "Maybe later");
    expect(
      assertNoLegacyFallbackTemplatePreviewSpoken({
        facts,
        laneBody: "ok",
        finalBody: LEGACY_FALLBACK_TEMPLATE_PREVIEW_STUB,
      })
    ).toBe("legacy_fallback_template_preview_speakable");
  });

  it("assertLegacyFallbackFinalGuardRan requires send path", () => {
    expect(
      assertLegacyFallbackFinalGuardRan({
        laneShouldSend: true,
        finalShouldSend: true,
        finalBody: "Humane coaching reply here.",
      })
    ).toBeNull();
    expect(
      assertLegacyFallbackFinalGuardRan({
        laneShouldSend: false,
        finalShouldSend: false,
        finalBody: "",
      })
    ).toBe("legacy_fallback_final_guard_not_ran");
  });

  it("assertTuSuppressesLegacyFallback requires TU authority flag", () => {
    const scenario = getScenarioById("legacy-fallback-tu-suppresses-fallback")!;
    const facts = buildInboundFacts(scenario, "Yes already done this morning");
    expect(assertTuSuppressesLegacyFallback(facts)).toBeNull();
  });
});

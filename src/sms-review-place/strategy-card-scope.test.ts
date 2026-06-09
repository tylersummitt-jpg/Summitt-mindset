import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { isInboundNormalStrategyCardEligible } from "@/lib/coaching-strategy-card-v1";
import { STRATEGY_CARD_SCENARIOS } from "@/sms-review-place/fixtures/strategy-card-scenarios";

const REPO = process.cwd();

describe("Phase 4.2 — Strategy Card scope guards", () => {
  it("Review Place strategy scenarios assert metadata fields, not exact SMS copy", () => {
    for (const scenario of STRATEGY_CARD_SCENARIOS) {
      expect(scenario.strategyCard).toBeDefined();
      expect(scenario.expectedBehavior.toLowerCase()).not.toMatch(/exact sms|verbatim body|must say/i);
    }
  });

  it("open_question_answer route remains ineligible for Strategy Card", () => {
    expect(
      isInboundNormalStrategyCardEligible({
        route_purpose: "normal_inbound_reply",
        open_question_facts: { latest_open_question: "When will you do it?" },
      } as Parameters<typeof isInboundNormalStrategyCardEligible>[0])
    ).toBe(false);
    expect(
      isInboundNormalStrategyCardEligible({
        route_purpose: "open_question_answer",
        open_question_facts: null,
      } as Parameters<typeof isInboundNormalStrategyCardEligible>[0])
    ).toBe(false);
  });

  it("daily and weekly lane files unchanged by Phase 4.2 Review Place work", () => {
    const daily = fs.readFileSync(
      path.join(REPO, "src/lib/v3-daily-relationship-lane.ts"),
      "utf8"
    );
    const weekly = fs.readFileSync(
      path.join(REPO, "src/lib/v3-weekly-outbound-relationship-lane.ts"),
      "utf8"
    );
    expect(daily).not.toContain("buildInboundNormalStrategyCardV1");
    expect(daily).not.toContain("STRATEGY_CARD_V1");
    expect(weekly).not.toContain("buildInboundNormalStrategyCardV1");
    expect(weekly).not.toContain("STRATEGY_CARD_V1");
  });

  it("Twilio send module not touched by sms-review-place strategy card files", () => {
    const reviewFiles = [
      "src/sms-review-place/strategy-card-validators.ts",
      "src/sms-review-place/fixtures/strategy-card-scenarios.ts",
      "src/sms-review-place/pipeline.ts",
    ];
    for (const rel of reviewFiles) {
      const content = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(content).not.toContain("@/lib/twilio");
      expect(content).not.toContain("sendSMS");
    }
  });

  it("no hard-coded final SMS in strategy card review modules", () => {
    const content = fs.readFileSync(
      path.join(REPO, "src/sms-review-place/fixtures/strategy-card-scenarios.ts"),
      "utf8"
    );
    expect(content).not.toMatch(/finalBodyMustEqual|expectedFinalSms|mustEqualBody/i);
  });

  it("single Strategy Card eligibility gate remains isInboundNormalStrategyCardEligible", () => {
    const inbound = fs.readFileSync(
      path.join(REPO, "src/lib/v3-inbound-relationship-lane.ts"),
      "utf8"
    );
    const eligibilityCalls = (inbound.match(/isInboundNormalStrategyCardEligible/g) ?? []).length;
    expect(eligibilityCalls).toBeGreaterThanOrEqual(1);
    expect(inbound).not.toMatch(/isOpenQuestionStrategyCardEligible|strategyCardEligibleForDaily/);
  });
});

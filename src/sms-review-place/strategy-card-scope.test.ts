import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  isArcClarifyStrategyCardEligible,
  isInboundNormalStrategyCardEligible,
  isOpenQuestionAnswerStrategyCardEligible,
} from "@/lib/coaching-strategy-card-v1";
import { buildInboundFacts } from "@/sms-review-place/build-facts";
import { getScenarioById } from "@/sms-review-place/fixtures/scenarios";
import { STRATEGY_CARD_SCENARIOS } from "@/sms-review-place/fixtures/strategy-card-scenarios";

const REPO = process.cwd();
const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sim-invalid.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sim-service-role-key-not-real";
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("Phase 4.2 — inbound-normal Strategy Card scope guards", () => {
  it("Review Place strategy scenarios assert metadata fields, not exact SMS copy", () => {
    for (const scenario of STRATEGY_CARD_SCENARIOS) {
      expect(scenario.strategyCard).toBeDefined();
      expect(scenario.expectedBehavior.toLowerCase()).not.toMatch(/exact sms|verbatim body|must say/i);
    }
  });

  it("open_question_facts on normal route remains ineligible for inbound-normal Strategy Card", () => {
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

  it("inbound lane wires inbound-normal Strategy Card eligibility", () => {
    const inbound = fs.readFileSync(
      path.join(REPO, "src/lib/v3-inbound-relationship-lane.ts"),
      "utf8"
    );
    const eligibilityCalls = (inbound.match(/isInboundNormalStrategyCardEligible/g) ?? []).length;
    expect(eligibilityCalls).toBeGreaterThanOrEqual(1);
    expect(inbound).toMatch(/isOpenQuestionAnswerStrategyCardEligible/);
    expect(inbound).not.toMatch(/strategyCardEligibleForDaily/);
  });
});

describe("Strategy Card scope — open_question_answer Review Place", () => {
  it("normal_inbound_reply scenario remains on normal Strategy Card surface", () => {
    const scenario = getScenarioById("consistent-winner");
    expect(scenario).toBeDefined();
    const facts = buildInboundFacts(scenario!, "Done before noon");
    expect(isInboundNormalStrategyCardEligible(facts)).toBe(true);
    expect(isOpenQuestionAnswerStrategyCardEligible(facts)).toBe(false);
  });

  it("open_question_answer scenarios are Strategy Card eligible", () => {
    const scenario = getScenarioById("open-question-clear-answer");
    expect(scenario).toBeDefined();
    const facts = buildInboundFacts(
      scenario!,
      "I'd need to eat before Brooke's workout so I'm not running on empty"
    );
    expect(facts.route_purpose).toBe("open_question_answer");
    expect(isOpenQuestionAnswerStrategyCardEligible(facts)).toBe(true);
    expect(isInboundNormalStrategyCardEligible(facts)).toBe(false);
    expect(isArcClarifyStrategyCardEligible(facts)).toBe(false);
  });

  it("arc_clarify_ambiguous_short scenarios are Strategy Card eligible", () => {
    const scenario = getScenarioById("arc-clarify-ambiguous-short");
    expect(scenario).toBeDefined();
    const facts = buildInboundFacts(scenario!, "k");
    expect(facts.route_purpose).toBe("arc_clarify_ambiguous_short");
    expect(isArcClarifyStrategyCardEligible(facts)).toBe(true);
    expect(isInboundNormalStrategyCardEligible(facts)).toBe(false);
    expect(isOpenQuestionAnswerStrategyCardEligible(facts)).toBe(false);
  });

  it("classifier boundary scenarios have no inbound Strategy Card surface", () => {
    const scenario = getScenarioById("crisis-safety-boundary");
    expect(scenario).toBeDefined();
    expect(scenario!.steps[0]!.lane).toBe("classifier");
  });

  it("daily scenarios remain outside open_question_answer card scope", () => {
    const scenario = getScenarioById("plan-not-proof");
    expect(scenario).toBeDefined();
    expect(scenario!.steps[0]!.lane).toBe("daily");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { isStrategyCardEligible } from "@/lib/coaching-strategy-card-v1";
import { buildInboundFacts } from "@/sms-review-place/build-facts";
import { CONVERSATION_BRAIN_FALLBACK_SCENARIOS } from "@/sms-review-place/fixtures/conversation-brain-fallback-scenarios";
import { resolveMockOpenAiResponse } from "@/sms-review-place/fixtures/openai-responses";
import { runScenarioStep } from "@/sms-review-place/pipeline";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sim-mock-key-not-real";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sim-invalid.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sim-service-role-key-not-real";
  createMock.mockImplementation(async (_req: unknown) => {
    const key = process.env.SMS_REVIEW_STEP_KEY?.trim() || "default";
    return resolveMockOpenAiResponse(key, _req);
  });
});

afterEach(() => {
  process.env = { ...envSnapshot };
  vi.clearAllMocks();
});

describe("SMS Review Place — legacy fallback scenarios", () => {
  for (const scenario of CONVERSATION_BRAIN_FALLBACK_SCENARIOS) {
    it(`${scenario.id} passes legacy fallback invariants without Strategy Card`, async () => {
      const step = scenario.steps[0]!;
      process.env.SMS_REVIEW_STEP_KEY = step.mockKey ?? `${scenario.id}:${step.lane}`;
      const userReply = step.userReply ?? "done";
      const facts = buildInboundFacts(scenario, userReply);

      expect(facts.route_purpose).toBe("conversation_brain_unavailable");
      expect(facts.branch_name).toBe("conversation_brain_legacy_disabled_lane");
      expect(facts.conversation_brain_fallback_facts).toBeTruthy();
      expect(isStrategyCardEligible(facts)).toBe(false);

      const row = await runScenarioStep(scenario, step, 0);

      expect(row.lane).toBe("inbound");
      expect(row.legacy_fallback_pass, row.legacy_fallback_failures.join("; ")).toBe(true);
      expect(row.legacy_fallback_failures).toEqual([]);
      expect(row.strategy_card_pass).toBeNull();
      expect(row.strategy_card_route_kind).toBeNull();
      expect(row.strategy_card_move_type).toBeNull();
      expect(row.final_body).not.toContain("STRATEGY_CARD_V1");
      expect(row.pass).toBe(true);
      expect(row.hard_flags).toEqual([]);
      expect(row.lane_should_send).toBe(true);
      expect(row.final_should_send).toBe(true);
      expect(row.final_body.trim().length).toBeGreaterThan(10);
    });
  }
});

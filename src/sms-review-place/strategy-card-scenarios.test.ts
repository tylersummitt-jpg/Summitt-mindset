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

import { STRATEGY_CARD_SCENARIOS } from "@/sms-review-place/fixtures/strategy-card-scenarios";
import { runScenarioStep } from "@/sms-review-place/pipeline";
import { resolveMockOpenAiResponse } from "@/sms-review-place/fixtures/openai-responses";

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

describe("SMS Review Place — Strategy Card scenarios", () => {
  for (const scenario of STRATEGY_CARD_SCENARIOS) {
    it(`${scenario.id} passes card metadata invariants`, async () => {
      const step = scenario.steps[0]!;
      process.env.SMS_REVIEW_STEP_KEY = step.mockKey ?? `${scenario.id}:${step.lane}`;
      const row = await runScenarioStep(scenario, step, 0);

      expect(row.strategy_card_pass, row.strategy_card_violations.join("; ")).toBe(true);
      expect(row.strategy_card_violations).toEqual([]);
      expect(row.strategy_card_move_type).toBeTruthy();
      expect(row.strategy_card_validation_status).toMatch(/valid|repaired/);
      if (scenario.expectClean !== false) {
        expect(row.pass, `hard_flags=${row.hard_flags.join(",")} lane_send=${row.lane_should_send} final_send=${row.final_should_send} body_len=${row.final_body.length} lane_reason=${row.lane_no_send_reason}`).toBe(true);
        expect(row.hard_flags).toEqual([]);
      } else {
        expect(row.strategy_card_pass).toBe(true);
        expect(row.hard_flags).toEqual([]);
      }
    });
  }
});

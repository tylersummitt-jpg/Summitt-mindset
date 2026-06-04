import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

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

import { buildDailyFacts } from "@/sms-review-place/build-facts";
import { peekMockLaneBody, resolveMockOpenAiResponse } from "@/sms-review-place/fixtures/openai-responses";
import { getEnabledScenarios, getScenarioById } from "@/sms-review-place/fixtures/scenarios";
import { runScenarioStep } from "@/sms-review-place/pipeline";
import { reportsRootDir, writeSmsReviewReport } from "@/sms-review-place/report";
import {
  expectedEnabledMockStepCount,
  getFilteredScenarios,
  runAllFilteredSteps,
} from "@/sms-review-place/run-review-runner";
import { looksLikeRawJsonSms } from "@/sms-review-place/sms-output";
import { evaluateHardFlags } from "@/sms-review-place/validators";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sim-mock-key-not-real";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sim-invalid.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sim-service-role-key-not-real";
  createMock.mockImplementation(async (_req: unknown) => {
    const key =
      process.env.SMS_REVIEW_STEP_KEY?.trim() ||
      process.env.SMS_REVIEW_SCENARIO?.trim() ||
      "default";
    return resolveMockOpenAiResponse(key, _req);
  });
});

afterEach(() => {
  process.env = { ...envSnapshot };
  vi.clearAllMocks();
});

describe("SMS Review Place — run review", () => {
  it("golden: consistent-winner daily step runs successfully", async () => {
    process.env.SMS_REVIEW_SCENARIO = "consistent-winner";
    const scenarios = getFilteredScenarios("mock");
    expect(scenarios.length).toBe(1);
    const step = scenarios[0]!.steps[0]!;
    process.env.SMS_REVIEW_STEP_KEY = step.mockKey ?? "consistent-winner:daily";
    const row = await runScenarioStep(scenarios[0]!, step, 0);
    expect(createMock).toHaveBeenCalled();
    expect(row.lane).toBe("daily");
    expect(row.lane_should_send).toBe(true);
    expect(row.final_should_send).toBe(true);
    expect(row.final_body.length).toBeGreaterThan(10);
    expect(looksLikeRawJsonSms(row.final_body)).toBe(false);
    expect(row.hard_flags).not.toContain("json_final_body");
    expect(row.lane_skipped_reason).toBeNull();
    expect(row.pass).toBe(true);
  });

  it("classifier-only crisis scenario does not call coaching lane produce", async () => {
    process.env.SMS_REVIEW_SCENARIO = "crisis-safety-boundary";
    const row = await runScenarioStep(getFilteredScenarios("mock")[0]!, { lane: "classifier", userReply: "I want to kill myself" }, 0);
    expect(row.lane).toBe("classifier");
    expect(row.lane_skipped_reason).toBe("classifier_only");
    expect(row.lane_body).toBe("");
    expect(row.classifier_results?.safety_tier).toBe("crisis");
    expect(createMock).not.toHaveBeenCalled();
    expect(row.pass).toBe(true);
  });

  it("intentionally bad variant triggers expected hard flags", async () => {
    process.env.SMS_REVIEW_SCENARIO = "warm-praise-overuse";
    const scenario = getFilteredScenarios("mock")[0]!;
    const step = scenario.steps[0]!;
    process.env.SMS_REVIEW_STEP_KEY = "warm-praise-overuse:bad";
    const row = await runScenarioStep(scenario, step, 0);
    expect(row.hard_flags.length).toBeGreaterThan(0);
    expect(
      row.hard_flags.includes("warm_praise_overuse") || row.hard_flags.includes("generic_momentum")
    ).toBe(true);
    expect(row.pass).toBe(true);
  });

  it("proof-victory-forbidden produces fake proof / Victory hard flags", async () => {
    process.env.SMS_REVIEW_SCENARIO = "proof-victory-forbidden";
    const scenario = getFilteredScenarios("mock")[0]!;
    const step = scenario.steps[0]!;
    process.env.SMS_REVIEW_STEP_KEY = "proof-victory-forbidden:bad";
    const row = await runScenarioStep(scenario, step, 0);
    expect(
      row.hard_flags.includes("fake_proof_claim") || row.hard_flags.includes("fake_victory_room_claim")
    ).toBe(true);
    expect(row.pass).toBe(true);
  });

  it("repeated-question-risk produces repeated_question hard flag", async () => {
    process.env.SMS_REVIEW_SCENARIO = "repeated-question-risk";
    const scenario = getFilteredScenarios("mock")[0]!;
    const step = scenario.steps[0]!;
    process.env.SMS_REVIEW_STEP_KEY = "repeated-question-risk:bad";
    const row = await runScenarioStep(scenario, step, 0);
    expect(row.hard_flags).toContain("repeated_question");
    expect(row.pass).toBe(true);
  });

  it("time-ref-yesterday bad mock triggers temporal_wording_violation", () => {
    const scenario = getScenarioById("time-ref-yesterday");
    expect(scenario).toBeDefined();
    const facts = buildDailyFacts(scenario!);
    const badBody = peekMockLaneBody("time-ref-yesterday:bad");
    expect(badBody).toBeTruthy();

    const flags = evaluateHardFlags({
      scenario: scenario!,
      lane: "daily",
      laneBody: "",
      laneShouldSend: false,
      laneNoSendReason: "fixture_only",
      finalBody: badBody!,
      finalBodyRaw: null,
      finalShouldSend: true,
      finalSkipReason: null,
      blockedReasons: [],
      latestUserReply: null,
      dailyFacts: facts,
      temporalContract: facts.temporal_contract ?? null,
      laneSkipped: false,
    });

    expect(flags).toContain("temporal_wording_violation");
  });

  it("time-ref-yesterday daily step sends with human final body", async () => {
    process.env.SMS_REVIEW_SCENARIO = "time-ref-yesterday";
    const scenario = getFilteredScenarios("mock")[0]!;
    const step = scenario.steps[0]!;
    process.env.SMS_REVIEW_STEP_KEY = step.mockKey ?? "time-ref-yesterday:daily";
    const row = await runScenarioStep(scenario, step, 0);
    expect(
      row.lane_should_send,
      `lane no-send: ${row.lane_no_send_reason ?? "unknown"}`
    ).toBe(true);
    expect(row.final_should_send).toBe(true);
    expect(row.final_body.length).toBeGreaterThan(10);
    expect(looksLikeRawJsonSms(row.final_body)).toBe(false);
    expect(row.hard_flags).not.toContain("temporal_wording_violation");
    expect(row.pass).toBe(true);
  });

  it("report generation smoke test", async () => {
    process.env.SMS_REVIEW_SCENARIO = "consistent-winner";
    const rows = await runAllFilteredSteps({ mode: "mock", setMockStepKey: true });
    expect(rows.length).toBeGreaterThan(0);
    const dir = writeSmsReviewReport(rows, { mode: "mock" });
    expect(fs.existsSync(path.join(dir, "run.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "report.md"))).toBe(true);
    const md = fs.readFileSync(path.join(dir, "report.md"), "utf8");
    expect(md).toContain("SMS Review Place");
    expect(md).toContain("consistent-winner");
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    expect(summary.run_mode).toBe("mock");
    expect(typeof summary.json_final_body_count).toBe("number");
  });

  it("runs all enabled scenarios when unfiltered", async () => {
    delete process.env.SMS_REVIEW_SCENARIO;
    delete process.env.SMS_REVIEW_PERSONA;
    const expectedSteps = expectedEnabledMockStepCount();
    const rows = await runAllFilteredSteps({ mode: "mock", setMockStepKey: true });
    expect(rows.length).toBe(expectedSteps);

    const enabled = getEnabledScenarios();
    for (const scenario of enabled) {
      const scenarioRows = rows.filter((r) => r.scenario_id === scenario.id);
      expect(scenarioRows.length).toBe(scenario.steps.length);
    }

    for (const row of rows.filter((r) => r.expect_clean)) {
      expect(
        row.pass,
        `${row.scenario_id}:${row.step_index}:${row.lane} flags=${row.hard_flags.join(",")} lane=${row.lane_no_send_reason ?? "—"} final=${row.final_skip_reason ?? "—"}`
      ).toBe(true);
      if (row.lane !== "classifier") {
        expect(row.final_should_send).toBe(true);
        expect(row.final_body.length).toBeGreaterThan(10);
        expect(looksLikeRawJsonSms(row.final_body)).toBe(false);
        expect(row.hard_flags).not.toContain("json_final_body");
      } else {
        expect(row.lane_skipped_reason).toBe("classifier_only");
      }
    }

    for (const row of rows.filter((r) => r.expect_hard_flags.length > 0)) {
      expect(row.hard_flags.length).toBeGreaterThan(0);
      expect(row.pass).toBe(true);
      expect(
        row.expect_hard_flags.some((f) => row.hard_flags.includes(f))
      ).toBe(true);
    }

    for (const row of rows) {
      if (row.expect_clean && row.final_should_send) {
        expect(looksLikeRawJsonSms(row.final_body)).toBe(false);
      }
    }

    if (process.env.SMS_REVIEW_SKIP_REPORT !== "1") {
      const dir = writeSmsReviewReport(rows, { mode: "mock" });
      expect(dir.startsWith(reportsRootDir("mock"))).toBe(true);
    }
  }, 120_000);
});

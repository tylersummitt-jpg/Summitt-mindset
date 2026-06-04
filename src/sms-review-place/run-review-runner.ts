/**
 * SMS Review Place — shared step runner (mock + real OpenAI modes).
 * No OpenAI/Twilio/Supabase imports.
 */

import { getEnabledScenarios } from "@/sms-review-place/fixtures/scenarios";
import { PERSONAS } from "@/sms-review-place/fixtures/personas";
import { runScenarioStep } from "@/sms-review-place/pipeline";
import type { SmsReviewRunMode, SmsReviewRunRow, SmsReviewScenario } from "@/sms-review-place/types";

const MOCK_SIM_API_KEY = "sim-mock-key-not-real";

/** Scenarios recommended for real OpenAI voice review. */
export const REAL_OPENAI_VOICE_SCENARIO_IDS = [
  "blocker-heavy",
  "repeated-miss-no-shame",
  "partial-not-win",
  "vague-reply",
  "time-ref-yesterday",
  "open-question-answered",
  "plan-not-proof",
  "consistent-winner",
] as const;

const REAL_OPENAI_BLOCKED_SCENARIO_IDS = new Set([
  "warm-praise-overuse",
  "repeated-question-risk",
  "proof-victory-forbidden",
]);

const REAL_OPENAI_MAX_STEPS_DEFAULT = 3;

export type RunAllFilteredStepsOptions = {
  mode: SmsReviewRunMode;
  /** Mock mode: set SMS_REVIEW_STEP_KEY before each step. */
  setMockStepKey?: boolean;
};

export type ScenarioFilterSnapshot = {
  scenario: string | null;
  persona: string | null;
  limit: number | null;
  all: boolean;
};

export function buildReviewRunOptions(mode: SmsReviewRunMode): {
  mode: SmsReviewRunMode;
  useMockSupplemental: boolean;
} {
  return {
    mode,
    useMockSupplemental: mode === "mock",
  };
}

export function scenarioFilterFromEnv(): ScenarioFilterSnapshot {
  const all = process.env.SMS_REVIEW_ALL === "1";
  const limitRaw = process.env.SMS_REVIEW_LIMIT?.trim();
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  return {
    scenario: process.env.SMS_REVIEW_SCENARIO?.trim() || null,
    persona: process.env.SMS_REVIEW_PERSONA?.trim() || null,
    limit: Number.isFinite(limit) && limit! > 0 ? limit! : null,
    all,
  };
}

export function assertFakePersonasOnly(scenarios: SmsReviewScenario[]): void {
  for (const s of scenarios) {
    const persona = PERSONAS[s.personaId];
    if (!persona) {
      throw new Error(`Unknown persona ${s.personaId} in scenario ${s.id}`);
    }
    if (!/^sim_/.test(persona.clerkUserId)) {
      throw new Error(
        `Refusing run: persona ${s.personaId} clerkUserId must be sim_* (got ${persona.clerkUserId})`
      );
    }
  }
}

export function assertRealOpenAiGates(): void {
  if (process.env.SMS_REVIEW_REAL_OPENAI !== "1") {
    throw new Error("SMS_REVIEW_REAL_OPENAI must be 1");
  }
  if (process.env.SMS_REVIEW_ACK_NETWORK !== "1") {
    throw new Error("SMS_REVIEW_ACK_NETWORK must be 1");
  }
  if (process.env.SMS_REVIEW_ACK_FAKE_USERS_ONLY !== "1") {
    throw new Error("SMS_REVIEW_ACK_FAKE_USERS_ONLY must be 1");
  }
  if (process.env.CI === "true") {
    throw new Error("Real OpenAI dry-run refused in CI");
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    throw new Error("Real OpenAI dry-run refused in GITHUB_ACTIONS");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Real OpenAI dry-run refused when NODE_ENV=production");
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for real OpenAI dry-run");
  }
  if (apiKey === MOCK_SIM_API_KEY) {
    throw new Error("OPENAI_API_KEY must not be the mocked Sim-1 test key");
  }

  const filter = scenarioFilterFromEnv();
  const allowAll = filter.all && process.env.SMS_REVIEW_ACK_COST === "1";
  if (!filter.scenario && !allowAll) {
    throw new Error(
      "Set SMS_REVIEW_SCENARIO=<id> or SMS_REVIEW_ALL=1 with SMS_REVIEW_ACK_COST=1"
    );
  }
}

export function getFilteredScenarios(mode: SmsReviewRunMode): SmsReviewScenario[] {
  const filter = scenarioFilterFromEnv();
  let scenarios = getEnabledScenarios({
    scenarioId: filter.scenario ?? undefined,
    personaId: filter.persona ?? undefined,
  });

  if (mode === "real_openai") {
    for (const s of scenarios) {
      if (REAL_OPENAI_BLOCKED_SCENARIO_IDS.has(s.id)) {
        throw new Error(
          `Scenario ${s.id} is mock-negative only; not allowed in real OpenAI mode`
        );
      }
    }

    const includeClassifier = process.env.SMS_REVIEW_INCLUDE_CLASSIFIER === "1";
    if (!includeClassifier) {
      scenarios = scenarios.filter((s) => !s.steps.every((st) => st.lane === "classifier"));
    }

    const allowAll = filter.all && process.env.SMS_REVIEW_ACK_COST === "1";
    if (allowAll && !filter.scenario) {
      const allowed = new Set<string>(REAL_OPENAI_VOICE_SCENARIO_IDS);
      scenarios = scenarios.filter((s) => allowed.has(s.id));
    }
  }

  assertFakePersonasOnly(scenarios);
  return scenarios;
}

function applyStepLimit(
  scenarios: SmsReviewScenario[],
  mode: SmsReviewRunMode
): { scenario: SmsReviewScenario; stepIndex: number }[] {
  const planned: { scenario: SmsReviewScenario; stepIndex: number }[] = [];
  for (const scenario of scenarios) {
    for (let i = 0; i < scenario.steps.length; i++) {
      planned.push({ scenario, stepIndex: i });
    }
  }

  if (mode !== "real_openai") {
    return planned;
  }

  const allowAll = process.env.SMS_REVIEW_ALL === "1" && process.env.SMS_REVIEW_ACK_COST === "1";
  if (allowAll) {
    const limitRaw = process.env.SMS_REVIEW_LIMIT?.trim();
    if (limitRaw) {
      const n = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(n) && n > 0) return planned.slice(0, n);
    }
    return planned;
  }

  const cap =
    process.env.SMS_REVIEW_LIMIT?.trim() ?
      Number.parseInt(process.env.SMS_REVIEW_LIMIT!, 10)
    : REAL_OPENAI_MAX_STEPS_DEFAULT;
  const maxSteps = Number.isFinite(cap) && cap > 0 ? cap : REAL_OPENAI_MAX_STEPS_DEFAULT;
  return planned.slice(0, maxSteps);
}

export async function runAllFilteredSteps(
  options: RunAllFilteredStepsOptions
): Promise<SmsReviewRunRow[]> {
  const scenarios = getFilteredScenarios(options.mode);
  const planned = applyStepLimit(scenarios, options.mode);

  if (options.mode === "real_openai") {
    process.env.SMS_REVIEW_USE_MOCK_SUPPLEMENTAL = "0";
  } else {
    delete process.env.SMS_REVIEW_USE_MOCK_SUPPLEMENTAL;
  }

  const rows: SmsReviewRunRow[] = [];
  for (const { scenario, stepIndex } of planned) {
    const step = scenario.steps[stepIndex]!;
    if (options.setMockStepKey) {
      const mockKey = step.mockKey ?? `${scenario.id}:${step.lane}`;
      process.env.SMS_REVIEW_STEP_KEY = mockKey;
    }
    const row = await runScenarioStep(scenario, step, stepIndex);
    rows.push({ ...row, run_mode: options.mode });
  }

  return rows;
}

export function expectedEnabledMockStepCount(): number {
  return getEnabledScenarios().reduce((n, s) => n + s.steps.length, 0);
}

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import {
  applyDailyStaleAskGuard,
  detectDailyStaleAskViolation,
  DAILY_STALE_ASK_BLOCKED,
} from "@/lib/daily-stale-ask-guard";
import type { DailySatisfiedAskContext } from "@/lib/daily-satisfied-ask-context";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);

const CALENDAR_ASK =
  "let me know if you're ready to put one family connection on the calendar for tomorrow";

function familySatisfiedContext(): DailySatisfiedAskContext {
  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: "plan_detail",
    do_not_repeat_asks: [CALENDAR_ASK],
    evidence_preview: "Call Bond about 12PM tomorrow",
    source: "inbound_turn_telemetry",
    occurred_at: "2026-06-04T18:00:00.000Z",
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    relationship_meaning: "plan_made",
    response_intent: "acknowledge_prior_ask_satisfied",
    prior_question_type: "plan_confirmation",
    outcome_proof_eligible: false,
    persistence_note: "no proof",
  };
}

function planConfirmationContext(): DailySatisfiedAskContext {
  return {
    has_satisfied_recent_ask: true,
    satisfied_ask_type: "plan_confirmation",
    do_not_repeat_asks: ["Does this 7-day step plan work?"],
    evidence_preview: "Yes",
    source: "inbound_turn_telemetry",
    occurred_at: "2026-06-03T12:00:00.000Z",
    last_ask_satisfied: "yes",
    stale_ask_risk: true,
    relationship_meaning: "plan_confirmed",
    response_intent: "acknowledge_prior_ask_satisfied",
    prior_question_type: "plan_confirmation",
    outcome_proof_eligible: false,
    persistence_note: "no proof",
  };
}

describe("detectDailyStaleAskViolation", () => {
  it("A: blocks family/calendar re-ask after satisfied plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(true);
  });

  it("B: allows safe outcome-close question", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the noon call with Bond happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("C: blocks plan-confirmation feel re-ask after user said yes", () => {
    const hit = detectDailyStaleAskViolation({
      body: "How does staying committed for the next 7 days feel?",
      satisfiedAskContext: planConfirmationContext(),
      answeredOpenQuestion: "Does this 7-day step plan work?",
    });
    expect(hit.violation).toBe(true);
  });

  it("D: allows safe next-step protection question", () => {
    const hit = detectDailyStaleAskViolation({
      body: "What will help you protect today's 10,000 steps?",
      satisfiedAskContext: planConfirmationContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("E: no satisfied context leaves normal accountability question unchanged", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did you get your steps in yesterday?",
      satisfiedAskContext: null,
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: allows Bond outcome-close after plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the conversation with Bond happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
      lastCoachQuestions: [
        "What actually happened with your distribution plan since your last check-in?",
      ],
      answeredOpenQuestion:
        "What actually happened with your distribution plan since your last check-in?",
      latestAnswerText: "Call Bond at 12PM tomorrow",
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: allows planned block outcome-close", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Did the planned block happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(false);
  });

  it("P0-A: blocks family calendar re-ask after plan detail", () => {
    const hit = detectDailyStaleAskViolation({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
    });
    expect(hit.violation).toBe(true);
  });
});

describe("applyDailyStaleAskGuard", () => {
  beforeEach(() => {
    repairMock.mockReset();
  });

  it("returns ok without repair when draft is safe", async () => {
    const result = await applyDailyStaleAskGuard({
      body: "Did the noon call with Bond happen, or did something get in the way?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
    });
    expect(result.outcome).toBe("ok");
    expect(repairMock).not.toHaveBeenCalled();
    expect(result.metadata.daily_stale_ask_detected).toBe(false);
  });

  it("F: repairs stale draft once and succeeds when repair is non-stale", async () => {
    repairMock.mockResolvedValueOnce({
      body: "Did the noon call with Bond happen, or did something get in the way?",
      model: "gpt-test",
    });
    const result = await applyDailyStaleAskGuard({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
      stage: "daily_post_final_voice_gate",
    });
    expect(repairMock).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("ok");
    expect(result.metadata.daily_stale_ask_repair_attempted).toBe(true);
    expect(result.metadata.daily_stale_ask_repair_succeeded).toBe(true);
    if (result.outcome === "ok") {
      expect(result.body).toMatch(/Bond/i);
    }
  });

  it("no-sends when repair still stale", async () => {
    repairMock.mockResolvedValueOnce({
      body: "Ready to put family time on the calendar tomorrow?",
      model: "gpt-test",
    });
    const result = await applyDailyStaleAskGuard({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
    });
    expect(result.outcome).toBe("no_send");
    if (result.outcome === "no_send") {
      expect(result.noSendReason).toBe(DAILY_STALE_ASK_BLOCKED);
      expect(result.metadata.daily_stale_ask_no_send_reason).toBe(DAILY_STALE_ASK_BLOCKED);
    }
  });

  it("no-sends when repair returns empty body", async () => {
    repairMock.mockResolvedValueOnce(null);
    const result = await applyDailyStaleAskGuard({
      body: "Are you ready to put one family connection on the calendar?",
      satisfiedAskContext: familySatisfiedContext(),
      routePurpose: "main_active_accountability",
    });
    expect(result.outcome).toBe("no_send");
  });
});

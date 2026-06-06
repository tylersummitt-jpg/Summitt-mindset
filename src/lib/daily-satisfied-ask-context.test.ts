import { describe, expect, it } from "vitest";

import {
  resolveDailySatisfiedAskContext,
  slimDailySatisfiedAskContextForTelemetry,
  type DailySatisfiedAskContext,
} from "@/lib/daily-satisfied-ask-context";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const CALENDAR_ASK =
  "let me know if you're ready to put one family connection on the calendar for tomorrow";

function telemetryEvent(overrides?: Partial<V2EventRowForAi["payload_json"]>): V2EventRowForAi {
  return {
    event_type: "sms_memory_signal",
    occurred_at: "2026-06-04T18:00:00.000Z",
    payload_json: {
      inbound_turn_telemetry: true,
      turn_understanding_last_ask_satisfied: "yes",
      do_not_repeat_asks: [CALENDAR_ASK],
      turn_understanding_stale_ask_violation_detected: true,
      prior_question_type: null,
      turn_understanding_relationship_meaning: "plan_made",
      turn_understanding_response_intent: "acknowledge_prior_ask_satisfied",
      raw_body_preview: "Call Bond about 12PM tomorrow",
      outcome_proof_eligible: false,
      ...overrides,
    },
  };
}

describe("resolveDailySatisfiedAskContext", () => {
  it("reads satisfied-ask truth from inbound_turn_telemetry events", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent()],
    });
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.do_not_repeat_asks).toContain(CALENDAR_ASK);
    expect(ctx?.evidence_preview).toMatch(/Bond/i);
    expect(ctx?.satisfied_ask_type).toBe("plan_detail");
    expect(ctx?.occurred_at).toBe("2026-06-04T18:00:00.000Z");
  });

  it("prefers inbound telemetry over lower-authority thread projection", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent()],
      latestOpenQuestion: "Different stale question?",
      latestAnswerAfterOpenQuestion: "Some other answer",
      openQuestionPending: false,
      doNotRepeatPhrases: ["different phrase"],
    });
    expect(ctx?.source).toBe("inbound_turn_telemetry");
    expect(ctx?.do_not_repeat_asks[0]).toMatch(/family connection on the calendar/i);
  });

  it("falls back to thread projection when no telemetry", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [],
      latestOpenQuestion: CALENDAR_ASK,
      latestAnswerAfterOpenQuestion: "I'll call Bond about 12PM tomorrow",
      openQuestionPending: false,
      doNotRepeatPhrases: [],
    });
    expect(ctx?.has_satisfied_recent_ask).toBe(true);
    expect(ctx?.source).toBe("thread_projection");
    expect(ctx?.satisfied_ask_type).toBe("plan_detail");
  });

  it("does not authorize proof from satisfied-ask context alone", () => {
    const ctx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [telemetryEvent({ outcome_proof_eligible: false })],
    });
    expect(ctx?.outcome_proof_eligible).toBe(false);
    expect(ctx?.persistence_note).toMatch(/does not authorize proof/i);

    const threadCtx = resolveDailySatisfiedAskContext({
      eventsNewestFirst: [],
      latestOpenQuestion: CALENDAR_ASK,
      latestAnswerAfterOpenQuestion: "Call Bond about 12PM tomorrow",
      openQuestionPending: false,
    });
    expect(threadCtx?.outcome_proof_eligible).toBe(false);
    expect(threadCtx?.persistence_note).toMatch(/not proof/i);
  });

  it("returns null when no satisfied ask signals exist", () => {
    expect(
      resolveDailySatisfiedAskContext({
        eventsNewestFirst: [],
        openQuestionPending: true,
      })
    ).toBeNull();
  });
});

describe("slimDailySatisfiedAskContextForTelemetry", () => {
  it("emits compact observability fields", () => {
    const ctx: DailySatisfiedAskContext = {
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
    expect(slimDailySatisfiedAskContextForTelemetry(ctx)).toEqual({
      has_satisfied_recent_ask: true,
      satisfied_ask_type: "plan_detail",
      do_not_repeat_asks_count: 1,
      daily_satisfied_ask_context_source: "inbound_turn_telemetry",
      evidence_preview: "Call Bond about 12PM tomorrow",
      occurred_at: "2026-06-04T18:00:00.000Z",
      last_ask_satisfied: "yes",
      stale_ask_risk: true,
      prior_question_type: "plan_confirmation",
      outcome_proof_eligible: false,
    });
  });
});

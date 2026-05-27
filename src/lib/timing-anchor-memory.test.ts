import { describe, expect, it } from "vitest";

import { derivePendingPlanProof } from "@/lib/pending-plan-proof";
import {
  anchorKeysMatch,
  deriveTimingAnchorMemory,
  detectAnchorConfirmationLanguage,
  extractTimingAnchorPhrase,
  inactiveTimingAnchorMemory,
  normalizeAnchorKey,
} from "@/lib/timing-anchor-memory";

const BROOKE_ONCE =
  "I'll do it after Brooke gets back from her workout.";
const BROOKE_PLAN =
  "I planned to make it happen last night, so I will make it happen today after Brooke gets back from her workout";
const DENTIST_ONCE = "I'll do it after my dentist appointment.";
const BROOKE_CONFIRMED =
  "Usually after Brooke's workout is my best window.";
const VAGUE_AFTER_THAT = "I'll do it after that.";

describe("normalizeAnchorKey", () => {
  it("maps Brooke workout phrases to brooke|workout", () => {
    expect(normalizeAnchorKey("after Brooke gets back from her workout")).toBe("brooke|workout");
    expect(normalizeAnchorKey("after Brooke's workout")).toBe("brooke|workout");
  });

  it("maps dentist appointment", () => {
    expect(normalizeAnchorKey("after my dentist appointment")).toBe("dentist|appointment");
  });

  it("returns null for vague anchors", () => {
    expect(normalizeAnchorKey("after that")).toBeNull();
  });
});

describe("deriveTimingAnchorMemory", () => {
  it("Test 1 — one Brooke mention", () => {
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: BROOKE_ONCE,
    });
    expect(memory.active).toBe(true);
    expect(memory.anchor_phrase_hint).toMatch(/Brooke/i);
    expect(memory.anchor_key).toBe("brooke|workout");
    expect(memory.confidence_level).toBe("mentioned_once");
    expect(memory.recurrence_confidence).toBe("unknown");
    expect(memory.mention_count_45d).toBe(1);
    expect(memory.user_confirmed).toBe(false);
    expect(memory.safe_usage_forbidden).toContain("assume_daily_schedule");
  });

  it("Test 2 — one dentist mention", () => {
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: DENTIST_ONCE,
    });
    expect(memory.active).toBe(true);
    expect(memory.anchor_key).toBe("dentist|appointment");
    expect(memory.confidence_level).toBe("mentioned_once");
    expect(memory.recurrence_confidence).toBe("unknown");
    expect(memory.user_confirmed).toBe(false);
    expect(memory.safe_usage_forbidden).toContain("call_it_usual");
  });

  it("Test 3 — repeated Brooke mentions across thread", () => {
    const thread = [
      "Coach: Did you get the block in?",
      `User: ${BROOKE_ONCE}`,
      "Coach: What about today?",
      `User: Same plan — after Brooke's workout.`,
    ].join("\n");
    const memory = deriveTimingAnchorMemory({
      recentExactThreadText: thread,
    });
    expect(memory.active).toBe(true);
    expect(memory.confidence_level).toBe("repeated");
    expect(memory.mention_count_45d).toBeGreaterThanOrEqual(2);
    expect(["low", "medium"]).toContain(memory.recurrence_confidence);
    expect(memory.user_confirmed).toBe(false);
  });

  it("Test 4 — explicit confirmation", () => {
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: BROOKE_CONFIRMED,
    });
    expect(memory.confidence_level).toBe("user_confirmed");
    expect(memory.recurrence_confidence).toBe("medium");
    expect(memory.user_confirmed).toBe(true);
    expect(memory.source).toBe("explicit_confirmation");
    expect(detectAnchorConfirmationLanguage(BROOKE_CONFIRMED)).toBe(true);
  });

  it("Test 5 — vague anchor inactive", () => {
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: VAGUE_AFTER_THAT,
    });
    expect(memory.active).toBe(false);
    expect(memory.anchor_key).toBeNull();
    expect(memory).toEqual(inactiveTimingAnchorMemory());
  });

  it("Test 6 — pending_plan_proof anchor_key link", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: "What actions will you take for distribution?",
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    expect(pending?.anchor_key).toBe("brooke|workout");
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      pendingPlanProof: pending,
    });
    expect(memory.anchor_key).toBe("brooke|workout");
    expect(anchorKeysMatch(pending!.anchor_key!, memory.anchor_key!)).toBe(true);
  });

  it("worked_before when proof after plan and pending inactive", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: "Distribution?",
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    expect(pending).not.toBeNull();
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      pendingPlanProof: null,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      userAnswersNewestFirst: [
        { text: BROOKE_PLAN, answered_at: "2026-05-11T20:30:00.000Z" },
        { text: "Yes, done.", answered_at: "2026-05-11T22:00:00.000Z" },
      ],
      recentEvents: [
        {
          event_type: "user_yes",
          occurred_at: "2026-05-11T22:00:00.000Z",
          payload_json: {},
        },
      ],
    });
    expect(memory.confidence_level).toBe("worked_before");
    expect(memory.outcome_success_after_mention_count).toBe(1);
    expect(memory.source).toBe("prior_success_pattern");
  });

  it("does not mark worked_before while pending_plan_proof still active", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: "Distribution?",
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    const memory = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: BROOKE_PLAN,
      pendingPlanProof: pending,
      userAnswersNewestFirst: [{ text: "Yes, done.", answered_at: "2026-05-11T22:00:00.000Z" }],
    });
    expect(pending?.active).toBe(true);
    expect(memory.confidence_level).not.toBe("worked_before");
    expect(memory.outcome_success_after_mention_count).toBe(0);
  });
});

describe("extractTimingAnchorPhrase", () => {
  it("extracts after and when patterns", () => {
    expect(extractTimingAnchorPhrase(BROOKE_ONCE)).toMatch(/after Brooke/i);
    expect(extractTimingAnchorPhrase("when Brooke gets back from her workout")).toMatch(/when Brooke/i);
  });
});

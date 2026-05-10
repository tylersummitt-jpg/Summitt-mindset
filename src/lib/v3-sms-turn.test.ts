import { describe, expect, it } from "vitest";
import {
  generateV3OpenQuestionAnswerReply,
  tryResolveAnswerToOpenQuestionTurn,
} from "./v3-sms-turn";

describe("tryResolveAnswerToOpenQuestionTurn — micro-step today → tomorrow defer", () => {
  it("routes tomorrow/late answer away from repeating smallest-step today question", () => {
    const latestQ =
      "What's the smallest honest next step you can still do today — 10 minutes or less?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "It's late so I'll have to get it done tomorrow",
      latestOpenQuestion: latestQ,
      expectedReplySemantics: "open_reflection",
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "distribution hour",
      behaviorStatement: "focus",
    });
    expect(r).not.toBeNull();
    expect(r?.subkind).toBe("defer_today_micro_step_to_tomorrow");
  });
});

describe("generateV3OpenQuestionAnswerReply — defer subkind", () => {
  it("does not repeat the smallest-step-today question", () => {
    const text = generateV3OpenQuestionAnswerReply({
      v3: {
        turnPurpose: "answer_to_open_question",
        subkind: "defer_today_micro_step_to_tomorrow",
        answeredOpenQuestion: true,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "tomorrow_concrete_time_after_micro_step_declined",
        extractedAnswer: "late tomorrow",
      },
      messageSid: "SM_test_defer_001",
      todayCompleted: false,
      effectiveAsk: "distribution",
    });
    expect(text.toLowerCase()).not.toContain("smallest honest next step");
    expect(text.toLowerCase()).not.toContain("10 minutes or less");
    expect(text.toLowerCase()).toMatch(/tomorrow|time|first 10|protecting/i);
  });
});

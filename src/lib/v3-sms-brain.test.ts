import { afterEach, describe, expect, it } from "vitest";
import { tryGenerateV3OpenQuestionCoachReply } from "./v3-sms-brain";
import type { NorthStarSmsContextPacket } from "./north-star-coach-sms";

describe("tryGenerateV3OpenQuestionCoachReply", () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("uses deterministic fallback when OpenAI is unavailable and does not loop empty", async () => {
    delete process.env.OPENAI_API_KEY;
    const pkt: NorthStarSmsContextPacket = {
      latestOpenQuestion: "What story are you writing tomorrow?",
      expectedReplySemantics: "future_plan_story_title",
      recentTranscriptLines: ["Coach: What story tomorrow?", "User: Grammar school recollections."],
      todayCompleted: false,
    };
    const r = await tryGenerateV3OpenQuestionCoachReply({
      resolution: {
        turnPurpose: "answer_to_open_question",
        subkind: "future_plan_story_title",
        answeredOpenQuestion: true,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_tomorrow_story_title",
        extractedAnswer: "Grammar school recollections",
      },
      inboundRaw: "Grammar school recollections",
      messageSid: "SM_openq_fallback",
      todayCompleted: false,
      effectiveAsk: "write daily",
      behaviorStatement: "writing",
      northStarPacket: pkt,
      coachingMemory: null,
      latestOpenQuestion: pkt.latestOpenQuestion ?? null,
      expectedReplySemantics: "future_plan_story_title",
      learningSignal: null,
    });
    expect(r.text.length).toBeGreaterThan(12);
    expect(r.openQuestionReplySource).toBe("deterministic_fallback");
    expect(r.text.toLowerCase()).not.toContain("what story are you");
  });
});

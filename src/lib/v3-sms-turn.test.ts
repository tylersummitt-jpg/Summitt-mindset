import { describe, expect, it } from "vitest";
import {
  extractBareHourTimeAnswer,
  extractTimeOrRangeAnswer,
  generateV3OpenQuestionAnswerReply,
  isBoundedYesNoOpenQuestionAnswer,
  looksLikeBlockerPhrase,
  tryResolveAnswerToOpenQuestionTurn,
} from "./v3-sms-turn";
import {
  inferExpectedReplySemanticsFromCoachQuestion,
} from "@/lib/north-star-sms-context-packet";

const ANGEL_TIME_QUESTION =
  "What specific time will you set for your calls tomorrow to keep things on track?";

const SISTER_SCHEDULE_Q =
  "Have you scheduled a time to connect with your sister about the get-together?";

function resolveCoachYesNo(inboundRaw: string, latestOpenQuestion: string) {
  const expectedReplySemantics = inferExpectedReplySemanticsFromCoachQuestion(latestOpenQuestion);
  return tryResolveAnswerToOpenQuestionTurn({
    inboundRaw,
    latestOpenQuestion,
    expectedReplySemantics,
    recentTranscriptLines: [],
    todayCompleted: false,
    effectiveAsk: "Daily connection",
    behaviorStatement: "Daily connection",
  });
}

function resolveTimeAnswer(inboundRaw: string, latestOpenQuestion: string = ANGEL_TIME_QUESTION) {
  const expectedReplySemantics = inferExpectedReplySemanticsFromCoachQuestion(latestOpenQuestion);
  return tryResolveAnswerToOpenQuestionTurn({
    inboundRaw,
    latestOpenQuestion,
    expectedReplySemantics,
    recentTranscriptLines: [],
    todayCompleted: false,
    effectiveAsk: "Make sales calls daily",
    behaviorStatement: "Make sales calls daily",
  });
}

describe("tryResolveAnswerToOpenQuestionTurn — coach_yes_no", () => {
  it("routes Yes to Have you scheduled… as open_question_answer", () => {
    const r = resolveCoachYesNo("Yes", SISTER_SCHEDULE_Q);
    expect(r).not.toBeNull();
    expect(r?.turnPurpose).toBe("answer_to_open_question");
    expect(r?.subkind).toBe("coach_yes_no");
    expect(r?.extractedAnswer).toBe("yes");
    expect(r?.shouldWriteOutcomeEvent).toBe(false);
  });

  it("routes No to Did you talk to her? as coach_yes_no", () => {
    const q = "Did you talk to her?";
    const r = resolveCoachYesNo("No", q);
    expect(r?.subkind).toBe("coach_yes_no");
    expect(r?.extractedAnswer).toBe("no");
  });

  it("routes Yes to Are you ready… as coach_yes_no", () => {
    const r = resolveCoachYesNo("Yes", "Are you ready for the meeting tomorrow?");
    expect(r?.subkind).toBe("coach_yes_no");
  });

  it("returns null for bare Yes without latest open question", () => {
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "Yes",
      latestOpenQuestion: null,
      expectedReplySemantics: "coach_yes_no",
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Daily",
      behaviorStatement: "Daily",
    });
    expect(r).toBeNull();
  });

  it("returns null for long paragraph on coach_yes_no", () => {
    const r = resolveCoachYesNo(
      "Yes I scheduled it for Tuesday afternoon with my sister",
      SISTER_SCHEDULE_Q
    );
    expect(r).toBeNull();
  });

  it("returns null for bare Yes on open_reflection blocker question", () => {
    const reflectionQ =
      "What's one thing that got in the way today — time, energy, or avoidance?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "Yes",
      latestOpenQuestion: reflectionQ,
      expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(reflectionQ),
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Daily habit",
      behaviorStatement: "Daily habit",
    });
    expect(r).toBeNull();
  });

  it("returns null for bare Yes when semantics is accountability_check", () => {
    const q = "Did you complete it today?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "Yes",
      latestOpenQuestion: q,
      expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(q),
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Two hours daily",
      behaviorStatement: "Two hours daily",
    });
    expect(r).toBeNull();
  });

  it("returns null for bare yes on unknown semantics (strong accountability-only guard)", () => {
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "Yes",
      latestOpenQuestion: "How are you feeling about progress?",
      expectedReplySemantics: "unknown",
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Two hours daily",
      behaviorStatement: "Two hours daily",
    });
    expect(r).toBeNull();
  });
});

describe("isBoundedYesNoOpenQuestionAnswer", () => {
  it("accepts bounded yes/no tokens only", () => {
    expect(isBoundedYesNoOpenQuestionAnswer("Yes")).toBe(true);
    expect(isBoundedYesNoOpenQuestionAnswer("nope")).toBe(true);
    expect(isBoundedYesNoOpenQuestionAnswer("maybe")).toBe(false);
    expect(isBoundedYesNoOpenQuestionAnswer("Yes I did")).toBe(false);
  });
});

describe("tryResolveAnswerToOpenQuestionTurn — Angel bare hour after time question", () => {
  it("routes bare 8 after what specific time question", () => {
    const r = resolveTimeAnswer("8");
    expect(r).not.toBeNull();
    expect(r?.turnPurpose).toBe("answer_to_open_question");
    expect(r?.subkind).toBe("time_or_schedule");
    expect(r?.extractedAnswer).toBe("8");
  });

  it("still routes 8am and 8:00", () => {
    const rAm = resolveTimeAnswer("8am");
    expect(rAm?.subkind).toBe("time_or_schedule");
    expect(rAm?.extractedAnswer).toMatch(/8/i);

    const rColon = resolveTimeAnswer("8:00");
    expect(rColon?.subkind).toBe("time_or_schedule");
    expect(rColon?.extractedAnswer).toMatch(/8:00/);
  });

  it("does not route bare 8 after non-time open question", () => {
    const storyQ = "What story will you dictate tomorrow?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "8",
      latestOpenQuestion: storyQ,
      expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(storyQ),
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Write daily",
      behaviorStatement: "Write daily",
    });
    expect(r).toBeNull();
  });

  it("does not route bare 8 after time, energy, or avoidance question", () => {
    const blockerQ = "What's the tightest constraint — time, energy, or avoidance?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "8",
      latestOpenQuestion: blockerQ,
      expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(blockerQ),
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Focus block",
      behaviorStatement: "Focus block",
    });
    expect(r).toBeNull();
  });

  it("routes discrete_choice tokens for time, energy, or avoidance question", () => {
    const blockerQ = "What's the tightest constraint — time, energy, or avoidance?";
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "time",
      latestOpenQuestion: blockerQ,
      expectedReplySemantics: "discrete_choice",
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Focus block",
      behaviorStatement: "Focus block",
    });
    expect(r?.subkind).toBe("discrete_choice");
    expect(r?.extractedAnswer).toBe("time");
  });
});

describe("extractBareHourTimeAnswer", () => {
  it("accepts single-token hours 1–12 only", () => {
    expect(extractBareHourTimeAnswer("8")).toBe("8");
    expect(extractBareHourTimeAnswer("12")).toBe("12");
    expect(extractBareHourTimeAnswer("7")).toBe("7");
    expect(extractBareHourTimeAnswer("0")).toBeNull();
    expect(extractBareHourTimeAnswer("13")).toBeNull();
    expect(extractBareHourTimeAnswer("8am")).toBeNull();
    expect(extractBareHourTimeAnswer("8 30")).toBeNull();
  });
});

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

describe("extractTimeOrRangeAnswer", () => {
  it("preserves 9-11am style windows", () => {
    expect(extractTimeOrRangeAnswer("9-11am focused block")).toMatch(/9.*11/i);
  });

  it("preserves bare 9 to 11 as a window (no am/pm)", () => {
    expect(extractTimeOrRangeAnswer("9 to 11")).toBe("9 to 11");
  });

  it("preserves bare hyphen ranges without am/pm", () => {
    expect(extractTimeOrRangeAnswer("9-11")).toMatch(/9.*11/i);
  });

  it("still extracts a single time when no range", () => {
    expect(extractTimeOrRangeAnswer("at 11am")).toMatch(/11/i);
  });
});

describe("generateV3OpenQuestionAnswerReply — time_or_schedule window copy", () => {
  it("uses window language for ranges", () => {
    const text = generateV3OpenQuestionAnswerReply({
      v3: {
        turnPurpose: "answer_to_open_question",
        subkind: "time_or_schedule",
        answeredOpenQuestion: true,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_block_time",
        extractedAnswer: "9-11am",
      },
      messageSid: "SM_range_001",
      todayCompleted: false,
      effectiveAsk: "focus",
    });
    expect(text.toLowerCase()).toContain("window");
    expect(text.toLowerCase()).toContain("first");
  });

  it("uses window language for bare 9 to 11 (word to)", () => {
    const text = generateV3OpenQuestionAnswerReply({
      v3: {
        turnPurpose: "answer_to_open_question",
        subkind: "time_or_schedule",
        answeredOpenQuestion: true,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_block_time",
        extractedAnswer: "9 to 11",
      },
      messageSid: "SM_range_bare_to",
      todayCompleted: false,
      effectiveAsk: "focus",
    });
    expect(text.toLowerCase()).toContain("window");
    expect(text.toLowerCase()).toContain("first");
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

describe("accountability completion must not hijack open-question lane", () => {
  const reflectionQ =
    "What's one thing that got in the way today — time, energy, or avoidance?";

  it("tryResolveAnswerToOpenQuestionTurn returns null for I did it!", () => {
    const r = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: "I did it!",
      latestOpenQuestion: reflectionQ,
      expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(reflectionQ),
      recentTranscriptLines: [],
      todayCompleted: false,
      effectiveAsk: "Daily habit",
      behaviorStatement: "Daily habit",
    });
    expect(r).toBeNull();
  });

  it("tryResolveAnswerToOpenQuestionTurn returns null for done and clear no answers", () => {
    for (const inbound of ["done", "yes", "nope", "not today"]) {
      const r = tryResolveAnswerToOpenQuestionTurn({
        inboundRaw: inbound,
        latestOpenQuestion: reflectionQ,
        expectedReplySemantics: inferExpectedReplySemanticsFromCoachQuestion(reflectionQ),
        recentTranscriptLines: [],
        todayCompleted: false,
        effectiveAsk: "Daily habit",
        behaviorStatement: "Daily habit",
      });
      expect(r).toBeNull();
    }
  });

  it("looksLikeBlockerPhrase is false for I did it!", () => {
    expect(looksLikeBlockerPhrase("I did it!")).toBe(false);
    expect(looksLikeBlockerPhrase("done")).toBe(false);
  });

  it("looksLikeBlockerPhrase stays true for genuine blocker explanations", () => {
    expect(looksLikeBlockerPhrase("I was blocked because work ran late")).toBe(true);
  });
});

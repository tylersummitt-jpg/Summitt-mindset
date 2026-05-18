import { describe, expect, it } from "vitest";

import {
  buildMemoryAntiRepeatRepairInstruction,
  detectSmsMemoryRepeatViolation,
  normalizeSmsMemoryRepeatText,
} from "@/lib/sms-memory-anti-repeat";

describe("detectSmsMemoryRepeatViolation", () => {
  it("flags exact repeated question", () => {
    const q = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: `Quick check — ${q}`,
      lastCoachQuestions: [q],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_recent_question");
    expect(v.repeatedQuestion).toMatch(/dictate today/i);
  });

  it("flags close substring repeated question", () => {
    const prior = "What specific stories are you considering for tomorrow?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "What specific stories are you considering for tomorrow?",
      lastCoachQuestions: [prior],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_recent_question");
  });

  it("ignores tiny phrases", () => {
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "Sounds good — keep going.",
      doNotRepeatPhrases: ["ok", "got it"],
      lastCoachQuestions: ["ok"],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("ignores STOP/HELP/compliance footer", () => {
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: "Great — what time works? Reply STOP to opt out.",
      doNotRepeatPhrases: ["Reply STOP to opt out"],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("ignores required contract binding when passed as requiredVerbatimSubstrings", () => {
    const binding = "Reply YES to accept this tighter overlay for the next 7 days.";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: binding,
      lastCoachQuestions: [binding],
      doNotRepeatPhrases: [binding],
      requiredVerbatimSubstrings: [binding],
    });
    expect(v.hasViolation).toBe(false);
  });

  it("does not flag acknowledgment that references prior question without re-asking", () => {
    const prior = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody:
        "You're right — you already shared Sunday School, the farm, and your mother's songs. Let's move forward from that.",
      lastCoachQuestions: [prior],
      answeredOpenQuestion: prior,
      latestAnswerText: "Sunday School, farm, songs Mother sang",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("flags re-asking answered open question", () => {
    const q = "What story will you dictate today?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: q,
      answeredOpenQuestion: q,
      latestAnswerText: "Sunday School, farm, songs Mother sang",
      lastCoachQuestions: [q],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_answered_open_question");
  });

  it("flags repeated do_not_repeat phrase", () => {
    const phrase = "What time will you protect for deep work tomorrow morning?";
    const v = detectSmsMemoryRepeatViolation({
      candidateBody: `Checking in — ${phrase}`,
      doNotRepeatPhrases: [phrase],
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_do_not_repeat_phrase");
  });
});

describe("detectSmsMemoryRepeatViolation allowed callbacks (M2B-5 hardening)", () => {
  const rbPriorQ = "What story will you dictate today?";
  const rbPriorAnswer = "Sunday School, farm, songs Mother sang";

  const rbMemoryInputs = {
    lastCoachQuestions: [rbPriorQ],
    answeredOpenQuestion: rbPriorQ,
    latestAnswerText: rbPriorAnswer,
    doNotRepeatPhrases: [rbPriorQ, rbPriorAnswer],
  };

  it("allows topical callback using prior answer without re-asking", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: "Use Sunday School or the farm today.",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows you-already-gave acknowledgment of prior answer", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody:
        "You already gave me Sunday School, the farm, and songs your mother sang.",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("allows forward-progress which-one follow-up question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: "Which one of those three will you start with?",
    });
    expect(v.hasViolation).toBe(false);
  });

  it("still flags exact repeated prior question", () => {
    const v = detectSmsMemoryRepeatViolation({
      ...rbMemoryInputs,
      candidateBody: rbPriorQ,
    });
    expect(v.hasViolation).toBe(true);
    expect(v.reason).toBe("repeated_answered_open_question");
  });
});

describe("buildMemoryAntiRepeatRepairInstruction", () => {
  it("includes answer text when repeating answered open question", () => {
    const instruction = buildMemoryAntiRepeatRepairInstruction({
      reason: "repeated_answered_open_question",
      repeatedPhrases: ["What story?"],
      repeatedQuestion: "What story will you dictate today?",
      latestAnswerText: "Sunday School lesson",
    });
    expect(instruction).toMatch(/do not ask/i);
    expect(instruction).toMatch(/Sunday School lesson/i);
  });
});

describe("normalizeSmsMemoryRepeatText", () => {
  it("strips compliance footer before compare", () => {
    const n = normalizeSmsMemoryRepeatText("What time? Reply STOP to opt out.");
    expect(n).not.toMatch(/stop/i);
    expect(n).toMatch(/what time/i);
  });
});

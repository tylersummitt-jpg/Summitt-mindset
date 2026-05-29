import { describe, expect, it } from "vitest";
import {
  coachQuestionExpectsTimeOrScheduleAnswer,
  inferExpectedReplySemanticsFromCoachQuestion,
} from "@/lib/north-star-sms-context-packet";

const ANGEL_TIME_QUESTION =
  "What specific time will you set for your calls tomorrow to keep things on track?";

describe("inferExpectedReplySemanticsFromCoachQuestion — time_or_schedule", () => {
  it("classifies Angel-style what specific time question", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion(ANGEL_TIME_QUESTION)).toBe(
      "time_or_schedule"
    );
  });

  it("classifies what exact time questions", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("What exact time are you blocking tomorrow?")).toBe(
      "time_or_schedule"
    );
  });

  it("classifies contiguous what time questions", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("What time will you start tomorrow?")).toBe(
      "time_or_schedule"
    );
  });

  it("does not classify time, energy, or avoidance as time_or_schedule", () => {
    expect(
      inferExpectedReplySemanticsFromCoachQuestion(
        "What's the tightest constraint — time, energy, or avoidance?"
      )
    ).toBe("discrete_choice");
  });

  it("does not classify unrelated time mentions as time_or_schedule", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("How much time do you need tonight?")).toBe(
      "open_reflection"
    );
  });
});

describe("coachQuestionExpectsTimeOrScheduleAnswer", () => {
  it("matches high-precision time question patterns only", () => {
    expect(coachQuestionExpectsTimeOrScheduleAnswer(ANGEL_TIME_QUESTION)).toBe(true);
    expect(coachQuestionExpectsTimeOrScheduleAnswer("What exact time works?")).toBe(true);
    expect(coachQuestionExpectsTimeOrScheduleAnswer("What time?")).toBe(true);
    expect(coachQuestionExpectsTimeOrScheduleAnswer("When will you block tomorrow?")).toBe(true);
    expect(coachQuestionExpectsTimeOrScheduleAnswer("time, energy, or avoidance")).toBe(false);
  });
});

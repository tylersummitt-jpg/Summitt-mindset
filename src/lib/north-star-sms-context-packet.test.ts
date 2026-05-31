import { describe, expect, it } from "vitest";
import {
  coachQuestionExpectsTimeOrScheduleAnswer,
  coachQuestionExpectsYesNoAnswer,
  inferExpectedReplySemanticsFromCoachQuestion,
  mergeInboundOpenQuestionAuthority,
} from "@/lib/north-star-sms-context-packet";

const ANGEL_TIME_QUESTION =
  "What specific time will you set for your calls tomorrow to keep things on track?";

const SISTER_SCHEDULE_Q =
  "Have you scheduled a time to connect with your sister about the get-together?";

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

describe("inferExpectedReplySemanticsFromCoachQuestion — coach_yes_no", () => {
  it("classifies Have you scheduled… as coach_yes_no", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion(SISTER_SCHEDULE_Q)).toBe("coach_yes_no");
  });

  it("classifies Did you talk to her? as coach_yes_no", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("Did you talk to her?")).toBe("coach_yes_no");
  });

  it("classifies Are you ready… as coach_yes_no", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("Are you ready for tomorrow's call?")).toBe(
      "coach_yes_no"
    );
  });

  it("classifies Does this work… as coach_yes_no", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("Does this work for your schedule?")).toBe(
      "coach_yes_no"
    );
  });

  it("keeps Did you complete it today? as accountability_check", () => {
    expect(inferExpectedReplySemanticsFromCoachQuestion("Did you complete it today?")).toBe(
      "accountability_check"
    );
  });

  it("does not classify contract Reply YES as coach_yes_no", () => {
    expect(
      inferExpectedReplySemanticsFromCoachQuestion("Reply YES to accept this tighter overlay?")
    ).not.toBe("coach_yes_no");
  });
});

describe("coachQuestionExpectsYesNoAnswer", () => {
  it("matches ordinary yes/no coach questions", () => {
    expect(coachQuestionExpectsYesNoAnswer(SISTER_SCHEDULE_Q)).toBe(true);
    expect(coachQuestionExpectsYesNoAnswer("Will you reach out before noon?")).toBe(true);
    expect(coachQuestionExpectsYesNoAnswer("Is this still the plan?")).toBe(true);
  });

  it("rejects binding contract consent phrasing", () => {
    expect(coachQuestionExpectsYesNoAnswer("Reply YES to confirm this contract?")).toBe(false);
  });
});

describe("mergeInboundOpenQuestionAuthority", () => {
  it("prefers thread memory open question when pending", () => {
    const merged = mergeInboundOpenQuestionAuthority({
      northStarLatestOpenQuestion: null,
      northStarExpectedSemantics: "unknown",
      threadLatestOpenQuestion: SISTER_SCHEDULE_Q,
      threadOpenQuestionPending: true,
      threadOpenQuestionExpectedAnswerType: "yes_no_partial",
    });
    expect(merged.latestOpenQuestion).toBe(SISTER_SCHEDULE_Q);
    expect(merged.expectedReplySemantics).toBe("coach_yes_no");
  });

  it("boosts yes_no_partial expected type to coach_yes_no", () => {
    const merged = mergeInboundOpenQuestionAuthority({
      northStarLatestOpenQuestion: SISTER_SCHEDULE_Q,
      northStarExpectedSemantics: "open_reflection",
      threadLatestOpenQuestion: SISTER_SCHEDULE_Q,
      threadOpenQuestionPending: true,
      threadOpenQuestionExpectedAnswerType: "yes_no_partial",
    });
    expect(merged.expectedReplySemantics).toBe("coach_yes_no");
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

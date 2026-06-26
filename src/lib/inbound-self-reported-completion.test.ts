import { describe, expect, it } from "vitest";
import {
  evaluateCompletionAlignmentForProof,
  isCommitmentAlignedRoutineStatusUpdateCompletion,
  isSubstantiveSelfReportedCompletionForProof,
} from "@/lib/inbound-self-reported-completion";

const TYLER_DISTRIBUTION_COMPLETION =
  "I got my distribution done today! I hit the goal! Woo hoo!";

const BROOKE_STEPS_COMPLETION =
  "I got my 10,000 steps today though! And I did it before we had a birthday party to go to";

const TENNESSEE_FUTURE_CONFIDENCE =
  "We're heading to Tennessee on Thursday. We live in Ohio and we're driving to Tennessee with all three kids so it'll throw us off our routine a little bit but I should still be able to hit the goals";

describe("isSubstantiveSelfReportedCompletionForProof", () => {
  const trueCases = [
    "I hit my goal today",
    "I hit the goal",
    "I got my distribution done today",
    "I got my workout done today",
    "I completed my run today",
    "I completed today's commitment",
    "I finished my goal",
    "I got it done",
    "Finished my goal",
    "Did my hour",
    "Just finished another 2 miles",
    TYLER_DISTRIBUTION_COMPLETION,
    BROOKE_STEPS_COMPLETION,
    "I got my 10,000 steps today",
    "I got my 10,000 steps in today",
    "I got my steps in today",
    "I got in 2 miles today",
    "I got my 2 miles in",
    "I got the 2 miles done",
    "I got my workout in",
    "I got my run in",
    "I got my walk in",
    "I got my calls done",
    "I got my distribution done",
    "I'm going to run 2 miles again in the morning. I completed my run today.",
  ];

  it.each(trueCases)("%s → true", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text)).toBe(true);
  });

  const falseCases = [
    "Yes",
    "Yep",
    "OK",
    "Sounds good",
    "Love it",
    "Done",
    "I'll hit it later",
    "I'm going to do it",
    "I will get it done",
    "I plan to finish tomorrow",
    "I want to change my goal",
    "I need to cancel my subscription",
    "STOP",
    TENNESSEE_FUTURE_CONFIDENCE,
    "I should still be able to hit the goals",
    "I should be able to hit the goal",
    "I will hit the goal",
    "I'm going to hit the goal",
    "I plan to hit it tomorrow",
    "I should be able to get it done",
    "I'll get it done later",
    "I haven't hit it yet",
  ];

  it.each(falseCases)("%s → false", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text)).toBe(false);
  });
});

describe("isCommitmentAlignedRoutineStatusUpdateCompletion", () => {
  const wakeCommitment = {
    commitmentBehaviorStatement: "Wake up on time without snoozing",
    effectiveAsk: "Get out of bed when the alarm goes off",
  };
  const readingCommitment = {
    commitmentBehaviorStatement: "Read for 30 minutes before bed",
    effectiveAsk: "Read tonight",
  };
  const statusText = "Getting up, showered, and ready for the day";

  it("allows wake-up/shower routine status when commitment aligns", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: statusText,
        ...wakeCommitment,
      })
    ).toBe(true);
    expect(isSubstantiveSelfReportedCompletionForProof(statusText, wakeCommitment)).toBe(true);
  });

  it("blocks the same status update when commitment does not align", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: statusText,
        ...readingCommitment,
      })
    ).toBe(false);
    expect(isSubstantiveSelfReportedCompletionForProof(statusText, readingCommitment)).toBe(false);
  });

  it("blocks future-intent routine phrasing", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: "I will get up and shower later",
        ...wakeCommitment,
      })
    ).toBe(false);
  });

  it("blocks scheduling/time answer Yes at 2pm", () => {
    expect(
      isCommitmentAlignedRoutineStatusUpdateCompletion({
        raw: "Yes at 2pm",
        ...wakeCommitment,
      })
    ).toBe(false);
    expect(isSubstantiveSelfReportedCompletionForProof("Yes at 2pm", wakeCommitment)).toBe(false);
  });
});

describe("completion alignment with active step commitment", () => {
  const stepCommitment = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  it.each([
    "I got my 10,000 steps today",
    "I walked 10,000 steps",
    "I got 10,000 steps by cleaning",
  ])("%s → substantive + aligned", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text, stepCommitment)).toBe(true);
    expect(evaluateCompletionAlignmentForProof(text, stepCommitment).aligned).toBe(true);
  });

  it.each([
    "I brushed my teeth today",
    "Well I hit my goal of brushing my teeth",
    "I completed my goal of brushing my teeth",
    "I met my goal of brushing my teeth",
  ])("%s → not substantive or not aligned", (text) => {
    const substantive = isSubstantiveSelfReportedCompletionForProof(text, stepCommitment);
    const alignment = evaluateCompletionAlignmentForProof(text, stepCommitment);
    expect(substantive || alignment.aligned).toBe(false);
    if (/\bgoal\s+of\b/i.test(text)) {
      expect(alignment.skipReason).toBe("off_goal_completion_claim");
    }
  });
});

describe("Brooke coalesced step completion", () => {
  const stepCommitment = {
    commitmentBehaviorStatement: "Walk 10,000 steps every day",
    effectiveAsk: "Did you get your 10,000 steps today?",
    commitmentTitle: "10,000 steps",
  };

  const BROOKE_COALESCED =
    "I got my goal this morning while walking the dogs\nI hit 10000 steps already";

  it("Brooke exact coalesced body is substantive aligned completion", () => {
    expect(isSubstantiveSelfReportedCompletionForProof(BROOKE_COALESCED, stepCommitment)).toBe(
      true
    );
    expect(evaluateCompletionAlignmentForProof(BROOKE_COALESCED, stepCommitment).aligned).toBe(
      true
    );
  });

  it("I hit 10000 steps already alone is substantive for step commitment", () => {
    expect(
      isSubstantiveSelfReportedCompletionForProof("I hit 10000 steps already", stepCommitment)
    ).toBe(true);
  });

  it("got my goal this morning alone without step metric is not substantive", () => {
    expect(
      isSubstantiveSelfReportedCompletionForProof(
        "I got my goal this morning while walking the dogs",
        stepCommitment
      )
    ).toBe(false);
  });
});

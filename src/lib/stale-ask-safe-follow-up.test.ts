import { describe, expect, it } from "vitest";

import {
  isExactOrNearRepeatOfPriorCoachAsk,
  isRecoveryOrOutcomeCloseFollowUp,
  isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk,
} from "@/lib/stale-ask-safe-follow-up";

const DIST_PRIOR =
  "What actually happened with your distribution plan since your last check-in?";

describe("isRecoveryOrOutcomeCloseFollowUp", () => {
  it("detects miss recovery patterns", () => {
    expect(isRecoveryOrOutcomeCloseFollowUp("What do you think led to that?")).toBe(true);
    expect(isRecoveryOrOutcomeCloseFollowUp("What got in the way yesterday?")).toBe(true);
    expect(isRecoveryOrOutcomeCloseFollowUp("How can you get back on track today?")).toBe(true);
  });

  it("detects outcome-close patterns", () => {
    expect(
      isRecoveryOrOutcomeCloseFollowUp(
        "Did the conversation with Bond happen, or did something get in the way?"
      )
    ).toBe(true);
    expect(
      isRecoveryOrOutcomeCloseFollowUp("Did the planned block happen, or did something get in the way?")
    ).toBe(true);
  });

  it("does not treat broad outcome re-ask as recovery", () => {
    expect(
      isRecoveryOrOutcomeCloseFollowUp(
        "What happened with your distribution plan since your last check-in?"
      )
    ).toBe(false);
  });
});

describe("isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk", () => {
  it("allows recovery after distribution outcome ask", () => {
    expect(
      isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk(
        "Missing a day happens. What do you think led to that? Let's explore how you can get back on track with your distribution plan.",
        DIST_PRIOR
      )
    ).toBe(true);
  });

  it("allows got in the way recovery", () => {
    expect(isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk("What got in the way yesterday?", DIST_PRIOR)).toBe(
      true
    );
  });

  it("blocks exact repeat even with question mark", () => {
    expect(isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk(DIST_PRIOR, DIST_PRIOR)).toBe(false);
    expect(isExactOrNearRepeatOfPriorCoachAsk(DIST_PRIOR, DIST_PRIOR)).toBe(true);
  });

  it("blocks near-repeat of same outcome frame", () => {
    expect(
      isSafeRecoveryOrOutcomeCloseNotRepeatingPriorAsk(
        "What happened with your distribution plan since your last check-in?",
        DIST_PRIOR
      )
    ).toBe(false);
  });
});

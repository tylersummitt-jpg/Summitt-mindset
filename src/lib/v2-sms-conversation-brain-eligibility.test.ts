import { describe, expect, it } from "vitest";

import {
  countRecentClarifyStyleHeuristic,
  isLikelyCommitmentChangeIntentTurn,
  isLikelySmsComplianceOrOptOutTurn,
  isSameDayGoalCompletionProofOnly,
  isUserCompletedGoalWantsToMoveOnLanguage,
  shouldUseSmsConversationBrainControl,
} from "@/lib/v2-sms-conversation-brain-eligibility";

const gateBase = {
  controlEnabled: true,
  allowlisted: true,
  pendingResolutionActive: false,
  contractOverlayActive: false,
  optOutOrComplianceTurn: false,
  commitmentChangeIntentLikely: false,
};

describe("shouldUseSmsConversationBrainControl", () => {
  it("returns false when control flag would be off", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        controlEnabled: false,
      })
    ).toBe(false);
  });

  it("returns false when user not allowlisted in a gated deployment", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        allowlisted: false,
      })
    ).toBe(false);
  });

  it("returns false when pending resolution owns the thread", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        pendingResolutionActive: true,
      })
    ).toBe(false);
  });

  it("returns false when contract overlay is active", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        contractOverlayActive: true,
      })
    ).toBe(false);
  });

  it("returns true for normal accountability when gates pass", () => {
    expect(shouldUseSmsConversationBrainControl(gateBase)).toBe(true);
  });

  it("returns false when commitment-change intent is likely", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        commitmentChangeIntentLikely: true,
      })
    ).toBe(false);
  });

  it("returns false when opt-out/compliance/help gate matches", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        optOutOrComplianceTurn: true,
      })
    ).toBe(false);
  });

  it("control + allowlist + commitment-change intent => gate false", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        commitmentChangeIntentLikely: isLikelyCommitmentChangeIntentTurn("I want to change my commitment"),
      })
    ).toBe(false);
  });

  it("control + allowlist + normal accountability => gate true", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        commitmentChangeIntentLikely: isLikelyCommitmentChangeIntentTurn("I missed it today"),
      })
    ).toBe(true);
  });

  it("control + allowlist + opt-out phrase => gate false", () => {
    expect(
      shouldUseSmsConversationBrainControl({
        ...gateBase,
        optOutOrComplianceTurn: isLikelySmsComplianceOrOptOutTurn("please stop texting me"),
      })
    ).toBe(false);
  });
});

describe("isLikelyCommitmentChangeIntentTurn", () => {
  const yes = [
    "I want to change my commitment",
    "I need to change my goal",
    "Can we switch my commitment?",
    "Can we switch from distribution to workouts?",
    "This commitment isn't right anymore",
    "This goal isn't working",
    "I need a new goal",
    "I want a new commitment",
    "I'm done with this goal",
    "I'm done with this commitment",
    "Can we replace this commitment?",
    "Can we tighten this commitment?",
    "I need to make this easier",
    "I need to make this smaller",
    "Can we adjust the bar?",
    "This bar is too much",
    "Rethink my commitment",
    "I picked the wrong commitment",
    "this goal is wrong",
    "the goal is wrong",
    "wrong goal",
    "I want a different goal",
    "new goal: walk after dinner",
    "my goal should be walking after dinner",
    "let's do walking after dinner instead",
    "I want to switch goals",
    "make it smaller permanently",
    "this goal is too easy",
    "raise the bar",
    "make it harder",
  ];

  it.each(yes)("matches commitment-change phrasing: %s", (s) => {
    expect(isLikelyCommitmentChangeIntentTurn(s)).toBe(true);
  });

  const no = [
    "I missed it today",
    "I didn't do it",
    "I only did 20 minutes",
    "I got it done",
    "I don't want to talk about it",
    "I'm frustrated",
    "This was hard today",
    "I failed today",
    "I need help tomorrow",
    "walking",
    "avoidance",
    "late night",
    "done",
    "yes",
    "no",
    "not today",
    "I did it",
    "missed it",
    "this week is impossible",
    "pause me until Monday",
    "I'm traveling this week",
  ];

  it.each(no)("does not match normal accountability / venting: %s", (s) => {
    expect(isLikelyCommitmentChangeIntentTurn(s)).toBe(false);
  });
});

describe("isLikelySmsComplianceOrOptOutTurn (brain gate)", () => {
  it("matches exact carrier tokens", () => {
    expect(isLikelySmsComplianceOrOptOutTurn("STOP")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("  help ")).toBe(true);
  });

  it("matches phrase-based opt-out and SMS help", () => {
    expect(isLikelySmsComplianceOrOptOutTurn("stop texting me")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("please stop texting me")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("don't text me anymore")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("unsubscribe me")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("remove me")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("cancel texts")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("how do I stop these texts")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("help with SMS")).toBe(true);
    expect(isLikelySmsComplianceOrOptOutTurn("I need help with SMS")).toBe(true);
  });

  it("does not match normal accountability or generic frustration", () => {
    expect(isLikelySmsComplianceOrOptOutTurn("I missed today")).toBe(false);
    expect(isLikelySmsComplianceOrOptOutTurn("I need help tomorrow")).toBe(false);
    expect(isLikelySmsComplianceOrOptOutTurn("This was hard")).toBe(false);
  });
});

describe("completed-goal move-on vs same-day proof", () => {
  const sameDayProofOnly = [
    "I finished my goal today",
    "I completed my goal today",
    "I accomplished my goal today",
    "finished the goal today",
    "completed the goal today",
    "I finished today's goal",
    "I completed today's goal",
    "I accomplished today's goal",
    "I finished my goal this morning",
    "I completed my goal this morning",
  ];

  it.each(sameDayProofOnly)("does not treat same-day proof as move-on: %s", (s) => {
    expect(isSameDayGoalCompletionProofOnly(s)).toBe(true);
    expect(isUserCompletedGoalWantsToMoveOnLanguage(s)).toBe(false);
    expect(isLikelyCommitmentChangeIntentTurn(s)).toBe(false);
  });

  const moveOn = [
    "I finished this goal and want to move on",
    "I completed that goal and want to move on",
    "I've accomplished this goal and would like to move on",
    "I've completed my goal of waking up on time and built consistency in that process",
    "I'm not focusing on my wake up time anymore",
    "Let's move on from this goal",
    "This goal is done and I want to work on something else",
  ];

  it.each(moveOn)("still treats goal transition as move-on: %s", (s) => {
    expect(isUserCompletedGoalWantsToMoveOnLanguage(s)).toBe(true);
  });
});

describe("countRecentClarifyStyleHeuristic", () => {
  it("counts clarify-style reply_resolution markers", () => {
    const n = countRecentClarifyStyleHeuristic([
      {
        event_type: "user_no",
        occurred_at: "2026-05-01T12:00:00Z",
        payload_json: {
          reply_resolution: { gated_mode: "clarify" },
        },
      },
    ]);
    expect(n).toBe(1);
  });
});

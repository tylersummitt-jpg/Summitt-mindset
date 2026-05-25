import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));

import { shouldOpenCommitmentChangeHandoff } from "@/lib/v2-sms-commitment-change";

const baseArgs = {
  gatedMode: "clarify" as const,
  userMessage: "change my goal to walking after dinner",
  plannedInterruptionActionable: false,
  classificationEventType: null as "user_yes" | "user_no" | "user_partial" | null,
};

describe("shouldOpenCommitmentChangeHandoff — default heuristic (no env flag)", () => {
  it("opens clear goal-edit phrases without AI gatedMode", () => {
    expect(shouldOpenCommitmentChangeHandoff(baseArgs)).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "this goal is wrong",
      })
    ).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "the goal is wrong",
      })
    ).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "wrong goal",
      })
    ).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "I want a different goal",
      })
    ).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "new goal: walk after dinner",
      })
    ).toBe(true);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "raise the bar",
      })
    ).toBe(true);
  });

  it("still opens when gatedMode is commitment_change_handoff", () => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        gatedMode: "commitment_change_handoff",
      })
    ).toBe(true);
  });

  it("blocks when plannedInterruptionActionable", () => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        gatedMode: "commitment_change_handoff",
        plannedInterruptionActionable: true,
      })
    ).toBe(false);
  });

  it("blocks strong user_yes and user_no accountability classifications", () => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        classificationEventType: "user_yes",
      })
    ).toBe(false);
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        classificationEventType: "user_no",
      })
    ).toBe(false);
  });

  it.each([
    "walking",
    "avoidance",
    "late night",
    "done",
    "yes",
    "no",
    "not today",
    "I did it",
    "missed it",
    "I missed today",
  ])("does not open handoff for short accountability reply: %s", (phrase) => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: phrase,
      })
    ).toBe(false);
  });

  it("does not open handoff for crisis-tier unsafe inbound", () => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        ...baseArgs,
        userMessage: "I'm going to hurt someone.",
      })
    ).toBe(false);
  });
});

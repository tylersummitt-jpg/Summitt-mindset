import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  isRefreshSessionActive: vi.fn(() => false),
}));
import {
  extractCandidateBarsFromSms,
  isIdentityLikeGoalCandidate,
} from "@/lib/v2-sms-commitment-change";
import { isVagueOrInvalidCandidateBar } from "@/lib/v2-sms-pending-resolution-complete";

describe("extractCandidateBarsFromSms — R1–R5 positives", () => {
  it.each([
    ["change my goal to walking after dinner", "walking after dinner"],
    ["change my commitment to phone away after dinner", "phone away after dinner"],
    ["New goal: walk after dinner", "walk after dinner"],
    ["My goal should be walking after dinner", "walking after dinner"],
    ["switch from phone away to walking after dinner", "walking after dinner"],
    ["Let's do walking after dinner instead", "walking after dinner"],
    ["I want my goal to be waking up before my kids", "waking up before my kids"],
    ["I want my new goal to be reading before bed", "reading before bed"],
    ["I need to change my goal to calling two customers before lunch", "calling two customers before lunch"],
    ["Make my goal getting to bed by 9:30", "getting to bed by 9:30"],
    ["Can you change it to waking up before my kids?", "waking up before my kids"],
  ])('extracts "%s" → "%s"', (input, expected) => {
    const r = extractCandidateBarsFromSms(input);
    expect(r.candidateNewBar).toBe(expected);
  });
});

describe("extractCandidateBarsFromSms — negatives", () => {
  it.each([
    "done",
    "yes",
    "no",
    "not today",
    "walking",
    "avoidance",
    "late night",
    "change my mind",
    "be healthier",
    "better",
    "something different",
    "I agree",
    "Yes I want to change my goal",
    "I want a different goal",
  ])("does not extract bare accountability phrase: %s", (input) => {
    const r = extractCandidateBarsFromSms(input);
    expect(r.candidateNewBar).toBeNull();
    expect(r.candidateTightenedBar).toBeNull();
  });

  it("does not extract did it instead without commitment cue", () => {
    const r = extractCandidateBarsFromSms("did it instead");
    expect(r.candidateNewBar).toBeNull();
  });

  it("does not treat change-it-to-my-new-goal as a concrete candidate", () => {
    const r = extractCandidateBarsFromSms("Can you change it to my new goal?");
    expect(r.candidateNewBar).toBeNull();
  });
});

describe("identity-like goal candidates", () => {
  it("flags be a better dad as identity-like", () => {
    expect(isIdentityLikeGoalCandidate("be a better dad")).toBe(true);
    expect(isVagueOrInvalidCandidateBar("be a better dad")).toBe(true);
  });
});

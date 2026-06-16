import { describe, expect, it } from "vitest";
import { isSubstantiveSelfReportedCompletionForProof } from "@/lib/inbound-self-reported-completion";

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
    "I got my distribution done today! I hit the goal! Woo hoo!",
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
  ];

  it.each(falseCases)("%s → false", (text) => {
    expect(isSubstantiveSelfReportedCompletionForProof(text)).toBe(false);
  });
});

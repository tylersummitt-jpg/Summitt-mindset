import { describe, expect, it } from "vitest";
import { isSubstantiveSelfReportedCompletionForProof } from "@/lib/inbound-self-reported-completion";

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

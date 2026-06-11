import { describe, expect, it } from "vitest";

import {
  CONTRACT_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  DAILY_MAIN_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  DAILY_REACTIVATION_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  GENERIC_FUTURE_RECOMMITMENT_DNR_ASK,
  GENERIC_FUTURE_RECOMMITMENT_DNR_FAMILY_KEY,
  INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  REFRESH_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  WEEKLY_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO,
  evaluateGenericFutureRecommitmentProductLaw,
  isGenericFutureRecommitmentQuestionFamily,
} from "@/lib/sms-generic-future-recommitment-question-family";

describe("isGenericFutureRecommitmentQuestionFamily", () => {
  it("detects stay committed next week question", () => {
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        "Are you ready to stay committed to your goal for the next week?"
      )
    ).toBe(true);
  });

  it("detects recommit for 7 days question", () => {
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        "Do you want to recommit to this for the next 7 days?"
      )
    ).toBe(true);
  });

  it("detects keep same bar this week question", () => {
    expect(isGenericFutureRecommitmentQuestionFamily("Want to keep the same bar this week?")).toBe(
      true
    );
  });

  it("does not detect normal daily accountability question", () => {
    expect(isGenericFutureRecommitmentQuestionFamily("What got in the way today?")).toBe(false);
    expect(
      isGenericFutureRecommitmentQuestionFamily("What is the next smallest step tonight?")
    ).toBe(false);
  });

  it("does not detect route-specific exact refresh fit-check phrased for today", () => {
    const specificBar = "Two hours of deep work before noon";
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        `Does this exact bar still fit today: ${specificBar}?`,
        { specificBarSubstrings: [specificBar] }
      )
    ).toBe(false);
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        "Does this exact bar still fit today: two hours deep work before noon?"
      )
    ).toBe(false);
  });

  it("does not detect coach-led recommendation that is not a question", () => {
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        "I'd keep today's bar simple: ten minutes after dinner."
      )
    ).toBe(false);
  });

  it("detects paraphrased generic recommit family", () => {
    expect(
      isGenericFutureRecommitmentQuestionFamily(
        "Does staying committed to the current goal for another week sound good?"
      )
    ).toBe(true);
  });
});

describe("evaluateGenericFutureRecommitmentProductLaw", () => {
  it("allows contract route when body includes specific bar substring", () => {
    const bar = "Ten minutes of mobility after dinner each night";
    const r = evaluateGenericFutureRecommitmentProductLaw({
      body: `Do you want to recommit to ${bar} for the next 7 days?`,
      routePurpose: "recommit_same",
      specificBarSubstrings: [bar],
    });
    expect(r.metadata.generic_recommitment_question_family_detected).toBe(false);
    expect(r.block).toBe(false);
  });

  it("blocks generic weekly recommit without route-specific bar", () => {
    const r = evaluateGenericFutureRecommitmentProductLaw({
      body: "Are you ready to stay committed to your goal for the next week?",
      routePurpose: "weekly_proof_v2",
    });
    expect(r.block).toBe(true);
    expect(r.metadata.generic_recommitment_question_family_detected).toBe(true);
  });
});

describe("writer must_not_do constants", () => {
  it("exports stable anti-generic recommit strings for Strategy Card surfaces", () => {
    expect(DAILY_MAIN_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/next-week|7-days/i);
    expect(DAILY_REACTIVATION_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/recommit/i);
    expect(WEEKLY_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/generic/i);
    expect(CONTRACT_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/server-authorized/i);
    expect(REFRESH_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/fit-check/i);
    expect(INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO).toMatch(/contract or refresh/i);
    expect(GENERIC_FUTURE_RECOMMITMENT_DNR_ASK).toMatch(/already asked recently/i);
    expect(GENERIC_FUTURE_RECOMMITMENT_DNR_FAMILY_KEY).toBe(
      "commitment_future_recommitment_question"
    );
  });
});

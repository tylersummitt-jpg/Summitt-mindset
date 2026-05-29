import { describe, expect, it } from "vitest";

import {
  MEANING_INTERPRETER_ANSWER_TYPES,
  MEANING_INTERPRETER_SECONDARY_INTENT_LABELS,
  MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION,
  MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2,
  parseAndValidateMeaningInterpreterShadow,
} from "@/lib/sms-meaning-interpreter-schema";

const baseV2 = {
  version: MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2,
  primary_intent: "open_question_answer",
  secondary_intents: ["time_answer_to_prior_question", "short_numeric_time_answer"],
  answer_type: "time_or_schedule",
  answered_prior_open_question: "yes",
  emotional_tone: "neutral",
  answered_open_question: "yes",
  open_question_answer_summary: "8",
  signals: {
    goal_change: false,
    pause_or_cadence: false,
    completion_or_proof: false,
    blocker: false,
    resistance_or_shame: false,
    substitution_counts: false,
  },
  safety_hint: "none",
  confidence: 0.91,
  disagrees_with_deterministic_route: false,
  disagreement_reason: null,
  explanation_short: "Numeric time answer to prior coach question.",
  recommended_followup_kind: "acknowledge",
};

describe("sms-meaning-interpreter schema v2", () => {
  it("accepts schema version 1 and 2", () => {
    expect(
      parseAndValidateMeaningInterpreterShadow({
        ...baseV2,
        version: MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION,
        secondary_intents: [],
      })?.version
    ).toBe(MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION);

    expect(parseAndValidateMeaningInterpreterShadow(baseV2)?.version).toBe(
      MEANING_INTERPRETER_SHADOW_SCHEMA_VERSION_V2
    );
  });

  it("parses v2 shadow-only labels in secondary_intents", () => {
    const parsed = parseAndValidateMeaningInterpreterShadow(baseV2);
    expect(parsed?.secondary_intents).toEqual([
      "time_answer_to_prior_question",
      "short_numeric_time_answer",
    ]);
    expect(parsed?.answer_type).toBe("time_or_schedule");
    expect(parsed?.answered_prior_open_question).toBe("yes");
  });

  it("parses contract and support/cancel secondary labels", () => {
    for (const label of [
      "contract_yes_answer",
      "contract_no_answer",
      "cancellation_request",
      "support_request",
    ] as const) {
      const parsed = parseAndValidateMeaningInterpreterShadow({
        ...baseV2,
        primary_intent: "accountability_answer",
        secondary_intents: [label],
        answer_type:
          label === "contract_yes_answer" || label === "contract_no_answer"
            ? "contract_yes_no"
            : label === "cancellation_request"
              ? "cancellation"
              : "support",
      });
      expect(parsed?.secondary_intents).toContain(label);
    }
  });

  it("nulls unknown answer_type without rejecting row", () => {
    const parsed = parseAndValidateMeaningInterpreterShadow({
      ...baseV2,
      answer_type: "mark_complete",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.answer_type).toBeNull();
  });

  it("documents expected secondary intent label set", () => {
    expect(MEANING_INTERPRETER_SECONDARY_INTENT_LABELS).toContain("answered_prior_open_question");
    expect(MEANING_INTERPRETER_ANSWER_TYPES).toContain("time_or_schedule");
  });
});

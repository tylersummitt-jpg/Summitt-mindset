import { describe, expect, it } from "vitest";
import {
  INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  buildInboundSolBriefExactContractPromptAppendix,
} from "@/lib/inbound-sol-brief-json-schema";
import {
  EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
  normalizeSolTrophyTitle,
  parseInboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";

describe("inbound Sol D1 schema extras", () => {
  it("requires pending_photo_relation on inbound extras", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toEqual(
      expect.arrayContaining([
        "pending_photo_relation",
        "meaningful_win",
        "durable_user_evidence",
      ])
    );
    expect(inbound.properties.pending_photo_relation.required).toEqual([
      "relation",
      "target_win_id",
    ]);
    expect(inbound.properties.pending_photo_relation.properties.relation.enum).toEqual([
      "none",
      "uncertain",
      "current_turn_win",
      "existing_win",
    ]);
    expect(inbound.properties.pending_photo_relation.properties.relation.enum).not.toContain(
      "abandon"
    );
  });

  it("missing pending_photo_relation defaults to none/null", () => {
    const extras = parseInboundSolBriefExtras({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "hello",
      },
      meaningful_win: null,
    });
    expect(extras?.pending_photo_relation).toEqual(
      EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION
    );
  });

  it("coerces none/uncertain/current_turn_win targets to null", () => {
    const extras = parseInboundSolBriefExtras({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "hiking",
      },
      meaningful_win: null,
      pending_photo_relation: {
        relation: "current_turn_win",
        target_win_id: "cccccccc-3333-4333-8333-333333333333",
      },
    });
    expect(extras?.pending_photo_relation).toEqual({
      relation: "current_turn_win",
      target_win_id: null,
    });
  });

  it("prompt appendix forbids inventing UUIDs and treats time as a clue not authority", () => {
    const appendix = buildInboundSolBriefExactContractPromptAppendix();
    expect(appendix).toContain("Never invent a UUID");
    expect(appendix).toContain("Elapsed time alone never pairs");
    expect(appendix).toContain("Explicit photo/picture/image nouns are not required");
    expect(appendix).toContain("awaiting_user is true");
    expect(appendix).toContain("exact Coach question already sent");
    expect(appendix).not.toContain("within 24");
    expect(appendix).not.toContain("Age in seconds is a fact, not evidence of relatedness");
  });
});

describe("inbound Sol win_presentation extras", () => {
  it("schema requires nullable trophy titles and forbids extra keys", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toContain("win_presentation");
    const presentation = inbound.properties.win_presentation;
    expect(presentation.additionalProperties).toBe(false);
    expect(presentation.required).toEqual([
      "accountability_trophy_title",
      "life_trophy_title",
    ]);
    expect(presentation.properties.accountability_trophy_title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(presentation.properties.life_trophy_title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("missing or malformed win_presentation does not fail the semantic extras parse", () => {
    const missing = parseInboundSolBriefExtras({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "central",
        outcome: "completed",
        confidence: "high",
        evidence: "yes",
      },
      meaningful_win: null,
    });
    expect(missing?.accountability_interpretation.outcome).toBe("completed");
    expect(missing?.win_presentation).toEqual({
      accountability_trophy_title: null,
      life_trophy_title: null,
    });

    const malformed = parseInboundSolBriefExtras({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "central",
        outcome: "completed",
        confidence: "high",
        evidence: "yes",
      },
      meaningful_win: null,
      win_presentation: "nope",
    });
    expect(malformed?.accountability_interpretation.outcome).toBe("completed");
    expect(malformed?.win_presentation.accountability_trophy_title).toBeNull();
  });

  it("prompt law is trophy chrome only and includes style goldens", () => {
    const appendix = buildInboundSolBriefExactContractPromptAppendix();
    expect(appendix).toContain("win_presentation");
    expect(appendix).toContain("does NOT determine whether a Win exists");
    expect(appendix).toContain("Lifted Weights");
    expect(appendix).toContain("Swam With the Kids");
    expect(appendix).toContain("Proud Moment With Daughter");
    expect(appendix).toContain("Do not rewrite grounded_action to trophy chrome");
    expect(appendix).toContain("Consistent Weight Lifting");
    expect(appendix).toContain("Being a Present Father");
    expect(appendix).toContain("Proud Family Support");
    expect(appendix).not.toContain("He recognized");
  });
});

describe("normalizeSolTrophyTitle", () => {
  it("accepts short trophy phrases and rejects empty, control, and >80", () => {
    expect(normalizeSolTrophyTitle("  Lifted Weights  ")).toBe("Lifted Weights");
    expect(normalizeSolTrophyTitle("Proud Moment With Daughter")).toBe(
      "Proud Moment With Daughter"
    );
    expect(normalizeSolTrophyTitle("")).toBeNull();
    expect(normalizeSolTrophyTitle("   ")).toBeNull();
    expect(normalizeSolTrophyTitle("Swam\nWith the Kids")).toBeNull();
    expect(normalizeSolTrophyTitle(`${"x".repeat(81)}`)).toBeNull();
    expect(normalizeSolTrophyTitle("x".repeat(80))).toBe("x".repeat(80));
  });
});

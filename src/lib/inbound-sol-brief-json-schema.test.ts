import { describe, expect, it } from "vitest";
import {
  INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  buildInboundSolBriefExactContractPromptAppendix,
} from "@/lib/inbound-sol-brief-json-schema";
import {
  EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
  parseInboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";

describe("inbound Sol D1 schema extras", () => {
  it("requires pending_photo_relation on inbound extras", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toEqual(
      expect.arrayContaining(["pending_photo_relation", "meaningful_win"])
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

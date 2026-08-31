import { describe, expect, it } from "vitest";
import {
  INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  buildInboundSolBriefExactContractPromptAppendix,
} from "@/lib/inbound-sol-brief-json-schema";
import {
  EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
  INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE,
  compactInboundSolBriefForTelemetry,
  normalizeSolTrophyTitle,
  parseInboundCoachingBriefV1,
  parseInboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";

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
      "accountability_supporting_quote",
      "life_supporting_quote",
    ]);
    expect(presentation.properties.accountability_trophy_title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(presentation.properties.life_trophy_title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(presentation.properties.accountability_supporting_quote).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(presentation.properties.life_supporting_quote).toEqual({
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
      accountability_supporting_quote: null,
      life_supporting_quote: null,
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
    expect(malformed?.win_presentation.accountability_supporting_quote).toBeNull();
    expect(malformed?.win_presentation.life_supporting_quote).toBeNull();
  });

  it("invalid quote types do not fail extras parse; strings pass through for persist grounding", () => {
    const parsed = parseInboundSolBriefExtras({
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
      win_presentation: {
        accountability_trophy_title: "Lifted Weights",
        life_trophy_title: null,
        accountability_supporting_quote: 12,
        life_supporting_quote: "Going to church with Brooke and the kids!",
      },
    });
    expect(parsed?.accountability_interpretation.outcome).toBe("completed");
    expect(parsed?.win_presentation.accountability_trophy_title).toBe("Lifted Weights");
    expect(parsed?.win_presentation.accountability_supporting_quote).toBeNull();
    expect(parsed?.win_presentation.life_supporting_quote).toBe(
      "Going to church with Brooke and the kids!"
    );
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
    expect(appendix).toContain("accountability_supporting_quote");
    expect(appendix).toContain("life_supporting_quote");
    expect(appendix).toContain("exact contiguous substring of latest_inbound_text");
    expect(appendix).toContain("Do not paraphrase");
    expect(appendix).toContain("Do not infer text from an image");
    expect(appendix).toContain("Do not copy one quote onto both Wins");
  });
});

function extrasBase(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

describe("inbound.requires_pat_personal_knowledge", () => {
  it("schema requires yes | no | unknown", () => {
    const inbound = INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties.inbound;
    expect(inbound.required).toContain("requires_pat_personal_knowledge");
    expect(inbound.properties.requires_pat_personal_knowledge).toEqual({
      type: "string",
      enum: ["yes", "no", "unknown"],
    });
    expect([...INBOUND_SOL_REQUIRES_PAT_PERSONAL_KNOWLEDGE]).toEqual([
      "yes",
      "no",
      "unknown",
    ]);
  });

  it("missing safely becomes unknown", () => {
    const extras = parseInboundSolBriefExtras(extrasBase());
    expect(extras?.requires_pat_personal_knowledge).toBe("unknown");
  });

  it("accepts yes, no, and unknown", () => {
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: "yes" }))
        ?.requires_pat_personal_knowledge
    ).toBe("yes");
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: "no" }))
        ?.requires_pat_personal_knowledge
    ).toBe("no");
    expect(
      parseInboundSolBriefExtras(
        extrasBase({ requires_pat_personal_knowledge: "unknown" })
      )?.requires_pat_personal_knowledge
    ).toBe("unknown");
  });

  it("invalid explicit enum fails extras parse (interpreter retry)", () => {
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: "maybe" }))
    ).toBeNull();
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: true }))
    ).toBeNull();
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: null }))
    ).toBeNull();
    expect(
      parseInboundSolBriefExtras(extrasBase({ requires_pat_personal_knowledge: "" }))
    ).toBeNull();
  });

  it("prompt appendix states yes/no/unknown law and interpreter boundary", () => {
    const appendix = buildInboundSolBriefExactContractPromptAppendix();
    expect(appendix).toContain("requires_pat_personal_knowledge: yes | no | unknown");
    expect(appendix).toContain("How did having Tyler change your coaching?");
    expect(appendix).toContain("What would you tell me about handling pressure?");
    expect(appendix).toContain("What did you learn from losing?");
    expect(appendix).toContain("What can I learn from losing?");
    expect(appendix).toContain("How did you handle pressure when you were coaching?");
    expect(appendix).toContain("How should I handle pressure?");
    expect(appendix).toMatch(
      /yes examples:[\s\S]*What did you learn from losing\?[\s\S]*How did you handle pressure when you were coaching\?/
    );
    expect(appendix).toMatch(
      /no examples:[\s\S]*What can I learn from losing\?[\s\S]*How should I handle pressure\?/
    );
    expect(appendix).not.toMatch(
      /unknown example:[\s\S]{0,80}What did you learn from losing\?/
    );
    expect(appendix).toContain("Asking about Pat's actual experience → yes");
    expect(appendix).toContain(
      "Do not use unknown merely because a Pat-personal question could also lead to a general coaching lesson"
    );
    expect(appendix).toContain("Do not set yes merely because the topic is leadership, discipline, losing");
    expect(appendix).toContain("does not select a Pat story");
    expect(appendix).toContain("search books");
    expect(appendix).toContain("retrieve chunks");
  });

  it("compact telemetry includes the flag", () => {
    const parsed = parseInboundCoachingBriefV1({
      version: MORNING_COACHING_BRIEF_VERSION,
      confidence: "high",
      human_situation: {
        most_alive: "Newest inbound",
        direct_question_or_need: null,
        relevant_life_event: null,
        context_use: "relevant",
        identity_use: "background",
        person_use: "do_not_force",
        selected_person: null,
        selected_person_reason: null,
      },
      truth_and_evidence: {
        latest_user_truth: "newest",
        outcome: "unknown",
        evidence_note: "unknown",
        evidence_strength: "none",
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      goal_role_today: {
        canonical_goal: "Lift 30 minutes",
        pending_goal: null,
        goal_alignment: "aligned",
        role: "background",
        note: "n",
      },
      coaching_direction: {
        primary_move: "answer",
        question_policy: "none",
        action_guidance: "none",
        pressure: "normal",
        proactive_decision: "send",
      },
      boundaries: {
        claims_to_avoid: [],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "History is not style.",
      },
      inbound: extrasBase({ requires_pat_personal_knowledge: "yes" }),
    });
    expect(parsed).not.toBeNull();
    expect(compactInboundSolBriefForTelemetry(parsed!)).toMatchObject({
      inbound_sol_requires_pat_personal_knowledge: "yes",
    });
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

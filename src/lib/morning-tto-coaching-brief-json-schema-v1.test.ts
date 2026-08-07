import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
  MORNING_BRIEF_SCHEMA_ENUMS,
  MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
} from "@/lib/morning-tto-coaching-brief-json-schema-v1";
import {
  MORNING_COACHING_BRIEF_VERSION,
  parseMorningCoachingBriefV1,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";

function validBrief(): MorningCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "User asked what to do about a tough work week",
      direct_question_or_need: "What should I focus on?",
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "I finished the deep work block",
      outcome: "completed",
      evidence_note: "One persisted completion",
      evidence_strength: "stated_once",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: true,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: ["yesterday's deep work"],
      answered_question: {
        question: "What will you dictate today?",
        answer: "Sunday School",
      },
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: ["What will you dictate today?"],
    },
    goal_role_today: {
      canonical_goal: "Dictate one story before noon",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "Question is more alive than the goal today",
    },
    coaching_direction: {
      primary_move: "answer",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent proof"],
      topics_not_to_force: ["Do not force Current Goal"],
      unsupported_capabilities: ["No app menus"],
      goal_authority_boundaries: ["Pending is unconfirmed"],
      identity_people_boundaries: ["Do not name-drop"],
      coach_history_is_not_style:
        "Prior coach messages are factual conversation history, not style examples.",
    },
  };
}

describe("morning coaching brief OpenAI JSON schema v1", () => {
  it("response_format is strict json_schema named morning_coaching_brief_v1", () => {
    expect(MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT.type).toBe("json_schema");
    expect(MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT.json_schema.strict).toBe(true);
    expect(MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT.json_schema.name).toBe(
      "morning_coaching_brief_v1"
    );
    expect(MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT.json_schema.schema).toBe(
      MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1
    );
  });

  it("schema requires all top-level Brief sections and forbids extras", () => {
    const schema = MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "version",
      "confidence",
      "human_situation",
      "truth_and_evidence",
      "conversation_continuity",
      "goal_role_today",
      "coaching_direction",
      "boundaries",
    ]);
    expect(schema.properties.version.enum).toEqual([MORNING_COACHING_BRIEF_VERSION]);
  });

  it("schema enums match parser-accepted tokens", () => {
    expect([...MORNING_BRIEF_SCHEMA_ENUMS.primary_move]).toEqual([
      "continue_conversation",
      "answer",
      "acknowledge_truth",
      "celebrate",
      "challenge",
      "clarify",
      "support",
      "offer_perspective",
      "simplify_next_move",
      "reconnect",
      "invite_reentry",
      "close_loop",
      "unknown",
    ]);
    expect([...MORNING_BRIEF_SCHEMA_ENUMS.question_policy]).toEqual([
      "none",
      "one_useful_question",
      "unknown",
    ]);
    expect([...MORNING_BRIEF_SCHEMA_ENUMS.goal_role]).toEqual([
      "central",
      "background",
      "unresolved",
      "do_not_mention",
      "unknown",
    ]);
    for (const move of MORNING_BRIEF_SCHEMA_ENUMS.primary_move) {
      const brief = {
        ...validBrief(),
        coaching_direction: { ...validBrief().coaching_direction, primary_move: move },
      };
      expect(parseMorningCoachingBriefV1(brief)?.coaching_direction.primary_move).toBe(move);
    }
  });

  it("exact-schema object is accepted by parseMorningCoachingBriefV1", () => {
    expect(parseMorningCoachingBriefV1(validBrief())).not.toBeNull();
  });

  it("writer module still uses json_object (untouched)", () => {
    const writerSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(writerSrc).toContain('response_format: { type: "json_object" }');
    expect(writerSrc).not.toContain("MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT");
  });

  it("Morning and Evening generate share the same interpreter entrypoint", () => {
    const generateSrc = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    const morningHits = generateSrc.match(/runObservationalMorningBriefInterpreter/g) ?? [];
    expect(morningHits.length).toBeGreaterThanOrEqual(2);
    expect(generateSrc).not.toMatch(/runObservationalEveningBriefInterpreter/);
    expect(generateSrc).toContain("fallback_brief_used");
    expect(generateSrc).not.toMatch(/meta\.parsed_brief\s*=\s*result\.brief/);
  });
});

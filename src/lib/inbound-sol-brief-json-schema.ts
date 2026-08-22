/**
 * Strict JSON Schema for inbound Sol interpreter — Morning six sections + inbound extras.
 */

import {
  MORNING_BRIEF_INTERPRETER_JSON_SCHEMA_NAME,
  MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  buildMorningBriefExactContractPromptAppendix,
} from "@/lib/morning-tto-coaching-brief-json-schema-v1";

const INBOUND_EXTRAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer_priority",
    "coaching_after_answer",
    "user_is_correcting_coach",
    "accountability_interpretation",
    "meaningful_win",
    "pending_photo_relation",
  ],
  properties: {
    answer_priority: { type: "string", enum: ["first", "normal", "unknown"] },
    coaching_after_answer: { type: "string", enum: ["yes", "no", "unknown"] },
    user_is_correcting_coach: {
      anyOf: [{ type: "boolean" }, { type: "string", enum: ["unknown"] }],
    },
    accountability_interpretation: {
      type: "object",
      additionalProperties: false,
      required: ["relevance", "outcome", "confidence", "evidence"],
      properties: {
        relevance: {
          type: "string",
          enum: ["central", "related", "unrelated", "unclear"],
        },
        outcome: {
          type: "string",
          enum: [
            "completed",
            "partial",
            "missed",
            "attempt",
            "plan",
            "unclear",
            "not_applicable",
          ],
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: { type: "string" },
      },
    },
    meaningful_win: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["present", "grounded_action", "relationship"],
          properties: {
            present: { type: "boolean", enum: [true] },
            grounded_action: { type: "string" },
            relationship: {
              type: "string",
              enum: ["goal", "mixed", "life", "unclear"],
            },
          },
        },
        { type: "null" },
      ],
    },
    pending_photo_relation: {
      type: "object",
      additionalProperties: false,
      required: ["relation", "target_win_id"],
      properties: {
        relation: {
          type: "string",
          enum: ["none", "uncertain", "current_turn_win", "existing_win"],
        },
        target_win_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
} as const;

export const INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1 = {
  ...MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  required: [
    ...MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.required,
    "inbound",
  ],
  properties: {
    ...MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1.properties,
    inbound: INBOUND_EXTRAS_SCHEMA,
  },
} as const;

export const INBOUND_SOL_BRIEF_JSON_SCHEMA_NAME = "inbound_coaching_brief_v1" as const;

export const INBOUND_SOL_BRIEF_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: INBOUND_SOL_BRIEF_JSON_SCHEMA_NAME,
    strict: true as const,
    schema: INBOUND_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  },
};

export function buildInboundSolBriefExactContractPromptAppendix(): string {
  return [
    buildMorningBriefExactContractPromptAppendix(),
    "",
    "INBOUND EXTRAS (required object `inbound`):",
    "answer_priority: first | normal | unknown",
    "coaching_after_answer: yes | no | unknown",
    "user_is_correcting_coach: true | false | unknown",
    "accountability_interpretation.relevance: central | related | unrelated | unclear",
    "accountability_interpretation.outcome: completed | partial | missed | attempt | plan | unclear | not_applicable",
    "accountability_interpretation.confidence: low | medium | high",
    "accountability_interpretation.evidence: short grounded quote or paraphrase of user evidence (not a guess)",
    "meaningful_win: null OR { present: true, grounded_action, relationship: goal | mixed | life | unclear }",
    "For a normal Current Goal completion only, prefer meaningful_win = null.",
    "pending_photo_relation: required { relation, target_win_id }",
    "relation: none | uncertain | current_turn_win | existing_win",
    "If pending_media_context.candidate_count is 0 or 2: relation MUST be none and target_win_id MUST be null.",
    "none / uncertain / current_turn_win: target_win_id MUST be null.",
    "existing_win: target_win_id MUST be copied from pending_media_context.recent_wins[].id. Never invent a UUID.",
    "current_turn_win means this inbound text is about the pending photo AND the Win created from THIS turn (UUID not known yet).",
    "Age in seconds is a fact, not evidence of relatedness. Do not treat recency as proof they belong together.",
    "Do not ask a photo-clarification question. Do not claim a photo was saved.",
    "Do not emit Morning-only keys as substitutes for inbound extras.",
    `Morning schema name remains ${MORNING_BRIEF_INTERPRETER_JSON_SCHEMA_NAME} for the six sections; inbound extras are additive.`,
  ].join("\n");
}

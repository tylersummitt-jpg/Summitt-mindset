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
    "requires_pat_personal_knowledge",
    "user_is_correcting_coach",
    "accountability_interpretation",
    "meaningful_win",
    "pending_photo_relation",
    "durable_user_evidence",
    "win_presentation",
  ],
  properties: {
    answer_priority: { type: "string", enum: ["first", "normal", "unknown"] },
    coaching_after_answer: { type: "string", enum: ["yes", "no", "unknown"] },
    requires_pat_personal_knowledge: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
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
    durable_user_evidence: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["exact_user_evidence"],
          properties: {
            exact_user_evidence: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    win_presentation: {
      type: "object",
      additionalProperties: false,
      required: ["accountability_trophy_title", "life_trophy_title"],
      properties: {
        accountability_trophy_title: { anyOf: [{ type: "string" }, { type: "null" }] },
        life_trophy_title: { anyOf: [{ type: "string" }, { type: "null" }] },
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
    "requires_pat_personal_knowledge: yes | no | unknown",
    "requires_pat_personal_knowledge asks ONLY whether a truthful answer to the newest inbound requires specific Pat Summitt autobiographical / historical fact (her life, career, family, players, championships, historical events, experiences, actions, feelings at a historical moment, or things she personally said/did in history).",
    "yes examples: \"Were you nervous speaking in public?\"; \"Did you ever struggle with confidence?\"; \"What was your favorite championship team?\"; \"How did having Tyler change your coaching?\"; \"Did you ever lose your temper with a player?\"; \"How did you become so disciplined?\"",
    "no examples: \"What would you tell me about handling pressure?\"; \"How do I get more disciplined?\"; \"I missed my workout.\"; \"Work was terrible.\"; \"What time does my morning text come?\"",
    "unknown example: \"What did you learn from losing?\" — wording does not establish whether autobiography is required.",
    "Do not set yes merely because the text is about leadership, discipline, pressure, or coaching in general.",
    "This field does not select a Pat story, search books, retrieve chunks, summarize biography, write SMS, or decide whether source evidence supports a historical claim.",
    "user_is_correcting_coach: true | false | unknown",
    "accountability_interpretation.relevance: central | related | unrelated | unclear",
    "accountability_interpretation.outcome: completed | partial | missed | attempt | plan | unclear | not_applicable",
    "accountability_interpretation.confidence: low | medium | high",
    "accountability_interpretation.evidence: short grounded quote or paraphrase of user evidence (not a guess)",
    "meaningful_win: null OR { present: true, grounded_action, relationship: goal | mixed | life | unclear }",
    "For a normal Current Goal completion only, prefer meaningful_win = null.",
    "Do not rewrite grounded_action to trophy chrome. grounded_action stays evidence language.",
    "win_presentation: required { accountability_trophy_title, life_trophy_title } — Victory Room display chrome only.",
    "win_presentation does NOT determine whether a Win exists. It cannot create a Win, change relationship, or replace grounded_action.",
    "accountability_trophy_title: string or null. Populate ONLY when this inbound is a completed accountability outcome the server will persist as user_yes. Else null.",
    "Example: Current Goal \"Lift weights for 30 minutes a day.\" + user \"yes\" → accountability_trophy_title \"Lifted Weights\".",
    "life_trophy_title: string or null. Populate ONLY when meaningful_win.relationship is life. Else null.",
    "Example: \"Probably swimming with them and watching how excited they were.\" → life_trophy_title \"Swam With the Kids\".",
    "Example: \"That's my daughter with princesses! Proud moment.\" → life_trophy_title \"Proud Moment With Daughter\".",
    "Trophy title style: concise, natural, trophy-like, factual, Title Case, typically 2–8 words, <=80 chars, no trailing period required.",
    "Natural trophy phrases are allowed (Family Vacation, Proud Moment With Daughter, Fully Present With the Kids) — not every title must be a full completed-action sentence.",
    "No member first name. No you. No he/she. No his/her as member narration. Prefer \"the kids\", \"daughter\", \"family\".",
    "No praise, no \"showed commitment\", no \"demonstrated\", no \"recognized\", no \"shared a proud moment involving\", no narrator sentences.",
    "Avoid abstract category labels when a natural trophy phrase exists (not \"Consistent Weight Lifting\", \"Being a Present Father\", \"Proud Family Support\").",
    "No invented facts. If a clean title would require inventing specificity, return null.",
    "If pronounless wording would distort meaning, return null (server will fall back). Do not emit a long explanatory sentence.",
    "durable_user_evidence: null OR { exact_user_evidence } — one verbatim contiguous substring of latest_inbound_text, or null",
    "Do not paraphrase, summarize, or select from exact_thread. When unsure, null.",
    "pending_photo_relation: required { relation, target_win_id }",
    "relation: none | uncertain | current_turn_win | existing_win",
    "If pending_media_context.candidate_count is 0 or 2: relation MUST be none and target_win_id MUST be null.",
    "none / uncertain / current_turn_win: target_win_id MUST be null.",
    "existing_win: target_win_id MUST be copied from pending_media_context.recent_wins[].id. Never invent a UUID.",
    "current_turn_win means this inbound text is about the pending photo AND the Win created from THIS turn (UUID not known yet).",
    "If awaiting_user is true, clarification_body is the exact Coach question already sent. Answering it is current_turn_win when this text is the Win.",
    "Inbound replies: proactive_decision must be send.",
    "Explicit photo/picture/image nouns are not required. A later caption of the same moment may be current_turn_win.",
    "Elapsed time alone never pairs. Recency/sequence may be one contextual clue with conversational continuity and text meaning.",
    "Do not pair when context conflicts or a human genuinely could not tell (uncertain). candidate_count 0 or 2: none.",
    "Do not ask a photo-clarification question. Do not claim a photo was saved.",
    "Do not emit Morning-only keys as substitutes for inbound extras.",
    `Morning schema name remains ${MORNING_BRIEF_INTERPRETER_JSON_SCHEMA_NAME} for the six sections; inbound extras are additive.`,
  ].join("\n");
}

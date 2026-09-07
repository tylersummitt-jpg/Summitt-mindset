/**
 * Strict JSON Schema for sol_goal_change_semantic_v1.
 * Aligned with parseSolGoalChangeSemanticResult — not a parallel type.
 */

import {
  SOL_GOAL_CHANGE_INTENTS,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
} from "@/lib/sol-goal-change-semantic";

export const SOL_GOAL_CHANGE_SEMANTIC_JSON_SCHEMA_NAME =
  "sol_goal_change_semantic_v1" as const;

export const SOL_GOAL_CHANGE_SEMANTIC_OPENAI_JSON_SCHEMA_V1 = {
  type: "object",
  additionalProperties: false,
  required: ["version", "goal_change", "concurrent_meaning"],
  properties: {
    version: {
      type: "string",
      enum: [SOL_GOAL_CHANGE_SEMANTIC_VERSION],
    },
    goal_change: {
      type: "object",
      additionalProperties: false,
      required: [
        "intent",
        "candidate_behavior_statement",
        "needs_clarification",
        "requires_confirmation",
        "confirms_existing_pending",
        "rejects_existing_pending",
        "modifies_existing_pending_candidate",
        "member_meaning_summary",
      ],
      properties: {
        intent: { type: "string", enum: [...SOL_GOAL_CHANGE_INTENTS] },
        candidate_behavior_statement: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        needs_clarification: { type: "boolean" },
        requires_confirmation: { type: "boolean" },
        confirms_existing_pending: { type: "boolean" },
        rejects_existing_pending: { type: "boolean" },
        modifies_existing_pending_candidate: { type: "boolean" },
        member_meaning_summary: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
    },
    concurrent_meaning: {
      type: "object",
      additionalProperties: false,
      required: ["planned_interruption", "accountability_update"],
      properties: {
        planned_interruption: { type: "boolean" },
        accountability_update: { type: "boolean" },
      },
    },
  },
} as const;

export const SOL_GOAL_CHANGE_SEMANTIC_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: SOL_GOAL_CHANGE_SEMANTIC_JSON_SCHEMA_NAME,
    strict: true as const,
    schema: SOL_GOAL_CHANGE_SEMANTIC_OPENAI_JSON_SCHEMA_V1,
  },
};

export function buildSolGoalChangeSemanticExactContractPromptAppendix(): string {
  return [
    "EXACT SCHEMA CONTRACT (field names + enums only — do not invent synonyms):",
    `version must be "${SOL_GOAL_CHANGE_SEMANTIC_VERSION}".`,
    "Use ONLY these field names. Do not invent keys like body, sms_body, reply, should_apply, mutate, pending_created.",
    `goal_change.intent: ${SOL_GOAL_CHANGE_INTENTS.join(" | ")}`,
    "goal_change.candidate_behavior_statement: string | null — proposed durable saved bar when known; otherwise null.",
    "goal_change.needs_clarification: boolean",
    "goal_change.requires_confirmation: boolean",
    "goal_change.confirms_existing_pending: boolean",
    "goal_change.rejects_existing_pending: boolean",
    "goal_change.modifies_existing_pending_candidate: boolean",
    "goal_change.member_meaning_summary: string | null — short description of member meaning, not SMS copy.",
    "concurrent_meaning.planned_interruption: boolean",
    "concurrent_meaning.accountability_update: boolean",
    "Never output user-visible SMS. Never include body / sms_body / message / reply.",
  ].join("\n");
}

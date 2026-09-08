/**
 * Strict JSON Schema for sol_goal_change_semantic_v1.
 * Aligned with parseSolGoalChangeSemanticResult — not a parallel type.
 */

import {
  SOL_GOAL_CHANGE_INTENTS,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MAX,
  SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MIN,
  SOL_GOAL_CHANGE_TEMPORARY_DURATION_KINDS,
  SOL_GOAL_CHANGE_TEMPORARY_WEEKDAYS,
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
        "reverts_active_temporary_overlay",
        "member_meaning_summary",
        "temporary_duration_kind",
        "temporary_duration_days",
        "temporary_weekday",
        "temporary_end_local_date",
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
        reverts_active_temporary_overlay: { type: "boolean" },
        member_meaning_summary: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        temporary_duration_kind: {
          type: "string",
          enum: [...SOL_GOAL_CHANGE_TEMPORARY_DURATION_KINDS],
        },
        temporary_duration_days: {
          anyOf: [
            {
              type: "integer",
              minimum: SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MIN,
              maximum: SOL_GOAL_CHANGE_TEMPORARY_DURATION_DAYS_MAX,
            },
            { type: "null" },
          ],
        },
        temporary_weekday: {
          anyOf: [
            { type: "string", enum: [...SOL_GOAL_CHANGE_TEMPORARY_WEEKDAYS] },
            { type: "null" },
          ],
        },
        temporary_end_local_date: {
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
    "Use ONLY these field names. Do not invent keys like body, sms_body, reply, should_apply, mutate, pending_created, adaptive_ask_expires_at, expires_at, expires_at_utc.",
    `goal_change.intent: ${SOL_GOAL_CHANGE_INTENTS.join(" | ")}`,
    "goal_change.candidate_behavior_statement: string | null — proposed durable saved bar when known; otherwise null.",
    "goal_change.needs_clarification: boolean",
    "goal_change.requires_confirmation: boolean",
    "goal_change.confirms_existing_pending: boolean",
    "goal_change.rejects_existing_pending: boolean",
    "goal_change.modifies_existing_pending_candidate: boolean",
    "goal_change.reverts_active_temporary_overlay: boolean — true ONLY when authoritative_active_overlay.active is true AND the member wants that live temporary overlay ended so canonical coaching is restored AND intent is none with no saved_replace/temporary_adjustment/pending/clarification/candidate. False when overlay is inactive/null. False when authoritative_pending is actionable. False when any other Goal Change transition is also set. False for ordinary coaching.",
    "goal_change.member_meaning_summary: string | null — short description of member meaning, not SMS copy.",
    `goal_change.temporary_duration_kind: ${SOL_GOAL_CHANGE_TEMPORARY_DURATION_KINDS.join(" | ")}`,
    "goal_change.temporary_duration_days: integer 1–14 | null — only when kind is days.",
    `goal_change.temporary_weekday: ${SOL_GOAL_CHANGE_TEMPORARY_WEEKDAYS.join(" | ")} | null — only when kind is through_weekday or until_weekday.`,
    "goal_change.temporary_end_local_date: YYYY-MM-DD string | null — only when kind is through_local_date or until_local_date. Never UTC. Never a timestamp.",
    "Temporary duration fields are meaningful ONLY when intent is temporary_adjustment. For every other intent: temporary_duration_kind=unspecified and the three detail fields null.",
    "Never output UTC timestamps. Never output adaptive_ask_expires_at. Server owns expiry calendar math.",
    "concurrent_meaning.planned_interruption: boolean",
    "concurrent_meaning.accountability_update: boolean",
    "Never output user-visible SMS. Never include body / sms_body / message / reply.",
  ].join("\n");
}

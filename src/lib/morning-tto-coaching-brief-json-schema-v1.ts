/**
 * OpenAI strict JSON Schema for morning_coaching_brief_v1.
 * Must stay aligned with parseMorningCoachingBriefV1 — not a parallel Brief.
 */

import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";

const CONTEXT_USE = ["relevant", "background", "do_not_force", "unknown"] as const;
const IDENTITY_PERSON_USE = [
  "relevant",
  "background",
  "do_not_force",
  "do_not_use",
  "unknown",
] as const;
const OUTCOMES = [
  "completed",
  "partial",
  "missed",
  "unknown",
  "no_recent_evidence",
] as const;
const EVIDENCE_STRENGTH = ["none", "stated_once", "repeated", "verified"] as const;
const GOAL_ALIGNMENT = [
  "aligned",
  "pending_confirmation",
  "thread_discussing_unconfirmed_alternative",
  "possibly_stale",
  "unknown",
] as const;
const GOAL_ROLE = [
  "central",
  "background",
  "unresolved",
  "do_not_mention",
  "unknown",
] as const;
const PRIMARY_MOVE = [
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
] as const;
const QUESTION_POLICY = ["none", "one_useful_question", "unknown"] as const;
const ACTION_GUIDANCE = ["none", "one_specific_next_step", "unknown"] as const;
const PRESSURE = ["low", "normal", "firm", "unknown"] as const;
const CONFIDENCE = ["low", "medium", "high"] as const;

/** Exported for prompt contract + tests — exact parser tokens. */
export const MORNING_BRIEF_SCHEMA_ENUMS = {
  context_use: CONTEXT_USE,
  identity_person_use: IDENTITY_PERSON_USE,
  outcome: OUTCOMES,
  evidence_strength: EVIDENCE_STRENGTH,
  goal_alignment: GOAL_ALIGNMENT,
  goal_role: GOAL_ROLE,
  primary_move: PRIMARY_MOVE,
  question_policy: QUESTION_POLICY,
  action_guidance: ACTION_GUIDANCE,
  pressure: PRESSURE,
  confidence: CONFIDENCE,
} as const;

/** Parser allows plain string or the token "unknown" — both are JSON strings. */
const stringOrUnknown = { type: "string" } as const;

/** Parser allows string | null | "unknown". */
const stringNullOrUnknown = { type: ["string", "null"] } as const;

const stringArrayOrUnknown = {
  anyOf: [
    { type: "array", items: { type: "string" } },
    { type: "string", enum: ["unknown"] },
  ],
} as const;

const selectedPerson = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        relationship: { type: "string" },
      },
      required: ["name", "relationship"],
    },
    { type: "null" },
  ],
} as const;

const answeredQuestion = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        answer: { type: "string" },
      },
      required: ["question", "answer"],
    },
    { type: "null" },
    { type: "string", enum: ["unknown"] },
  ],
} as const;

const pendingGoal = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        candidate_text: { type: "string" },
        status: { type: "string" },
      },
      required: ["candidate_text", "status"],
    },
    { type: "null" },
  ],
} as const;

/**
 * Strict JSON Schema object for Chat Completions response_format.json_schema.schema.
 * additionalProperties: false everywhere OpenAI strict mode requires it.
 */
export const MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1 = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "confidence",
    "human_situation",
    "truth_and_evidence",
    "conversation_continuity",
    "goal_role_today",
    "coaching_direction",
    "boundaries",
  ],
  properties: {
    version: { type: "string", enum: [MORNING_COACHING_BRIEF_VERSION] },
    confidence: { type: "string", enum: [...CONFIDENCE] },
    human_situation: {
      type: "object",
      additionalProperties: false,
      required: [
        "most_alive",
        "direct_question_or_need",
        "relevant_life_event",
        "context_use",
        "identity_use",
        "person_use",
        "selected_person",
        "selected_person_reason",
      ],
      properties: {
        most_alive: stringOrUnknown,
        direct_question_or_need: stringNullOrUnknown,
        relevant_life_event: stringNullOrUnknown,
        context_use: { type: "string", enum: [...CONTEXT_USE] },
        identity_use: { type: "string", enum: [...IDENTITY_PERSON_USE] },
        person_use: { type: "string", enum: [...IDENTITY_PERSON_USE] },
        selected_person: selectedPerson,
        selected_person_reason: stringNullOrUnknown,
      },
    },
    truth_and_evidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "latest_user_truth",
        "outcome",
        "evidence_note",
        "evidence_strength",
        "consistency_supported",
        "proof_claims_allowed",
      ],
      properties: {
        latest_user_truth: stringNullOrUnknown,
        outcome: { type: "string", enum: [...OUTCOMES] },
        evidence_note: stringOrUnknown,
        evidence_strength: { type: "string", enum: [...EVIDENCE_STRENGTH] },
        consistency_supported: { type: "boolean" },
        proof_claims_allowed: {
          type: "object",
          additionalProperties: false,
          required: ["completion", "miss", "partial", "proof"],
          properties: {
            completion: { type: "boolean" },
            miss: { type: "boolean" },
            partial: { type: "boolean" },
            proof: { type: "boolean" },
          },
        },
      },
    },
    conversation_continuity: {
      type: "object",
      additionalProperties: false,
      required: [
        "already_acknowledged",
        "answered_question",
        "open_loop",
        "stale_or_exhausted_topics",
        "do_not_repeat",
      ],
      properties: {
        already_acknowledged: stringArrayOrUnknown,
        answered_question: answeredQuestion,
        open_loop: stringNullOrUnknown,
        stale_or_exhausted_topics: stringArrayOrUnknown,
        do_not_repeat: stringArrayOrUnknown,
      },
    },
    goal_role_today: {
      type: "object",
      additionalProperties: false,
      required: ["canonical_goal", "pending_goal", "goal_alignment", "role", "note"],
      properties: {
        canonical_goal: { type: "string" },
        pending_goal: pendingGoal,
        goal_alignment: { type: "string", enum: [...GOAL_ALIGNMENT] },
        role: { type: "string", enum: [...GOAL_ROLE] },
        note: stringOrUnknown,
      },
    },
    coaching_direction: {
      type: "object",
      additionalProperties: false,
      required: ["primary_move", "question_policy", "action_guidance", "pressure"],
      properties: {
        primary_move: { type: "string", enum: [...PRIMARY_MOVE] },
        question_policy: { type: "string", enum: [...QUESTION_POLICY] },
        action_guidance: { type: "string", enum: [...ACTION_GUIDANCE] },
        pressure: { type: "string", enum: [...PRESSURE] },
      },
    },
    boundaries: {
      type: "object",
      additionalProperties: false,
      required: [
        "claims_to_avoid",
        "topics_not_to_force",
        "unsupported_capabilities",
        "goal_authority_boundaries",
        "identity_people_boundaries",
        "coach_history_is_not_style",
      ],
      properties: {
        claims_to_avoid: { type: "array", items: { type: "string" } },
        topics_not_to_force: { type: "array", items: { type: "string" } },
        unsupported_capabilities: { type: "array", items: { type: "string" } },
        goal_authority_boundaries: { type: "array", items: { type: "string" } },
        identity_people_boundaries: { type: "array", items: { type: "string" } },
        coach_history_is_not_style: { type: "string" },
      },
    },
  },
} as const;

export const MORNING_BRIEF_INTERPRETER_JSON_SCHEMA_NAME =
  "morning_coaching_brief_v1" as const;

/** Chat Completions response_format for the shared Sol interpreter. */
export const MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: MORNING_BRIEF_INTERPRETER_JSON_SCHEMA_NAME,
    strict: true as const,
    schema: MORNING_COACHING_BRIEF_OPENAI_JSON_SCHEMA_V1,
  },
};

/** Compact prompt appendix — tokens only; structured output is authoritative. */
export function buildMorningBriefExactContractPromptAppendix(): string {
  return [
    "EXACT SCHEMA CONTRACT (field names + enums only — do not invent synonyms):",
    `version must be "${MORNING_COACHING_BRIEF_VERSION}".`,
    "Use ONLY these field names. Do not invent keys like summary, emotional_read, timing_context, known, supported_claims, unsupported_claims, live_open_loop, continuity_priority, intent, focus, tone, do_not_claim, do_not_do, supporting_context, background_context.",
    `confidence: ${CONFIDENCE.join(" | ")}`,
    "human_situation: most_alive, direct_question_or_need, relevant_life_event, context_use, identity_use, person_use, selected_person, selected_person_reason",
    `context_use: ${CONTEXT_USE.join(" | ")}`,
    `identity_use / person_use: ${IDENTITY_PERSON_USE.join(" | ")}`,
    "truth_and_evidence: latest_user_truth, outcome, evidence_note, evidence_strength, consistency_supported, proof_claims_allowed",
    `outcome: ${OUTCOMES.join(" | ")}`,
    `evidence_strength: ${EVIDENCE_STRENGTH.join(" | ")}`,
    "conversation_continuity: already_acknowledged, answered_question, open_loop, stale_or_exhausted_topics, do_not_repeat",
    "goal_role_today: canonical_goal, pending_goal, goal_alignment, role, note",
    `goal_alignment: ${GOAL_ALIGNMENT.join(" | ")}`,
    `role: ${GOAL_ROLE.join(" | ")}`,
    "coaching_direction: primary_move, question_policy, action_guidance, pressure",
    `primary_move: ${PRIMARY_MOVE.join(" | ")}`,
    `question_policy: ${QUESTION_POLICY.join(" | ")}`,
    `action_guidance: ${ACTION_GUIDANCE.join(" | ")}`,
    `pressure: ${PRESSURE.join(" | ")}`,
    "boundaries: claims_to_avoid, topics_not_to_force, unsupported_capabilities, goal_authority_boundaries, identity_people_boundaries, coach_history_is_not_style",
    "Meaning → exact tokens (examples, not exhaustive):",
    "- low-pressure reconnection → primary_move=reconnect AND pressure=low (never low_pressure_reconnection)",
    "- supporting/background goal context → role=background (never background_context / supporting_context)",
    "- concise motivational support → primary_move=support (never deliver_concise_evening_motivation)",
    "String-or-unknown fields may be the string \"unknown\". Nullable string fields may be null or \"unknown\".",
    "Array-or-unknown fields may be a string array or the string \"unknown\".",
  ].join("\n");
}

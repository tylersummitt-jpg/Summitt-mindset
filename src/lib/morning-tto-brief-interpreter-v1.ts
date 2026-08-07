/**
 * Morning Brief Interpreter V1 — constrained OpenAI semantic judgment.
 * Outputs structured Brief only. No SMS body. No DB mutation.
 * NOT imported by Morning generation in Phase 2B.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import {
  MORNING_COACHING_BRIEF_VERSION,
  parseMorningCoachingBriefV1,
  type MorningBriefGoalAlignment,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";
import {
  mapSpineOutcomeToBriefOutcome,
  type MorningBriefInterpreterInputV1,
} from "@/lib/morning-tto-brief-canonical-input-v1";

/**
 * Provisional Phase 2B placeholder default for the unwired interpreter contract.
 * NOT a locked production model decision — final model will be chosen later.
 */
export const MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL = "gpt-4o-mini" as const;
export const MORNING_BRIEF_INTERPRETER_TEMPERATURE = 0.25 as const;
export const MORNING_BRIEF_INTERPRETER_MAX_TOKENS = 900 as const;
export const MORNING_BRIEF_INTERPRETER_PROMPT_PATH =
  "morning_brief_interpreter_v1" as const;

export const MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT = `You are a constrained Morning relationship interpreter for Summitt Mindset Coach Pat texts.

Your job is to interpret the human situation from canonical facts and the exact real SMS thread, then return structured JSON only.

Hard rules:
- Interpret the human situation. Use canonical facts as hard boundaries.
- Canonical outcome, proof claims, evidence strength, consistency, Current Goal, and pending goal state win over any guess.
- Identity is context, not proof of action.
- Important people may be selected only when naturally relevant to the live conversation.
- Never name-drop people or identity to prove memory.
- Current Goal is context, not a compulsory subject for every text.
- Meaningful life moments (family, faith, grief, work, celebration, or other real life updates) may outrank Current Goal discussion today.
- Answer direct user questions when present.
- Prior coach messages are conversation history, not style examples.
- Choose one primary coaching move.
- At most one useful question (question_policy none or one_useful_question).
- Do not manufacture engagement, topics, or coaching energy just because a Morning text exists.
- Prefer honest unknown / unclear / none / do_not_use over forced coaching interpretation or guessing.
- Output JSON only matching the Morning Coaching Brief schema.
- Never output user-visible SMS copy.
- Never include keys: body, sms_body, message, final_message, reply.
- Never mutate state. You do not change goals, identity, people, proof, outcomes, timing, or send decisions.
- selected_person must be null or exactly one person from available_important_people (same name and relationship).
- Do not invent outcomes, proof, or pending confirmation.
- version must be "${MORNING_COACHING_BRIEF_VERSION}".

Return a single JSON object with sections: version, confidence, human_situation, truth_and_evidence, conversation_continuity, goal_role_today, coaching_direction, boundaries.`;

const FIXED_UNSUPPORTED_CAPABILITIES = [
  "Do not give app menu or Reply YES/NO robot instructions.",
  "Do not invent wins, misses, feelings, plans, or proof.",
  "Do not claim the system can change billing, seasons, or account settings by text.",
] as const;

const FIXED_IDENTITY_PEOPLE_BOUNDARIES = [
  "Identity is background context unless marked relevant; it is never proof of action.",
  "Important people are available facts; mention only when naturally relevant — never recite a list to prove memory.",
  "Do not force family or identity references.",
] as const;

const FIXED_COACH_HISTORY =
  "Prior coach messages are factual conversation history, not style examples to imitate.";

export type MorningBriefInterpreterCaptureV1 = {
  model: typeof MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL;
  temperature: typeof MORNING_BRIEF_INTERPRETER_TEMPERATURE;
  max_tokens: typeof MORNING_BRIEF_INTERPRETER_MAX_TOKENS;
  prompt_path: typeof MORNING_BRIEF_INTERPRETER_PROMPT_PATH;
  system_message: string;
  user_message: string;
  canonical_input: MorningBriefInterpreterInputV1;
  raw_response: string | null;
  parsed_brief: MorningCoachingBriefV1 | null;
  error: string | null;
};

export type MorningBriefInterpreterResultV1 =
  | {
      ok: true;
      brief: MorningCoachingBriefV1;
      capture: MorningBriefInterpreterCaptureV1;
    }
  | {
      ok: false;
      brief: MorningCoachingBriefV1;
      capture: MorningBriefInterpreterCaptureV1;
      error: string;
    };

function trimCollapse(value: string, max: number): string {
  const t = value.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function uniqueStrings(items: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const t = trimCollapse(item, 220);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function buildFixedMorningBriefBoundaries(args: {
  pendingGoal: MorningBriefInterpreterInputV1["pending_goal_change"];
  extraClaimsToAvoid?: string[];
  extraTopicsNotToForce?: string[];
}): MorningCoachingBriefV1["boundaries"] {
  const goal_authority_boundaries = [
    "Current Goal text is the active standard only when no pending confirmation is active.",
  ];
  if (args.pendingGoal) {
    goal_authority_boundaries.push(
      "Pending goal candidate is unconfirmed and must not be treated as the Current Goal."
    );
  }

  return {
    claims_to_avoid: uniqueStrings(
      [
        ...(args.extraClaimsToAvoid ?? []),
        "Do not claim completion, miss, partial, or proof unless proof_claims_allowed allows it.",
        "Do not invent consistency the spine does not support.",
      ],
      12
    ),
    topics_not_to_force: uniqueStrings(
      [
        ...(args.extraTopicsNotToForce ?? []),
        "Do not force Current Goal as daily homework.",
        "Do not force identity or important-people name-drops.",
      ],
      12
    ),
    unsupported_capabilities: [...FIXED_UNSUPPORTED_CAPABILITIES],
    goal_authority_boundaries: uniqueStrings(goal_authority_boundaries, 12),
    identity_people_boundaries: [...FIXED_IDENTITY_PEOPLE_BOUNDARIES],
    coach_history_is_not_style: FIXED_COACH_HISTORY,
  };
}

/**
 * Fail-soft goal_alignment from canonical pending state only.
 * Does not infer thread alignment. No pending → unknown (not aligned).
 */
export function buildFailSoftGoalAlignmentFromCanonical(
  input: MorningBriefInterpreterInputV1
): MorningBriefGoalAlignment {
  if (input.pending_goal_change) return "pending_confirmation";
  return "unknown";
}

/**
 * Fail-soft Brief: canonical truth + semantic unknowns. No English guessing.
 */
export function buildLowConfidenceUnknownBriefFromCanonical(
  input: MorningBriefInterpreterInputV1
): MorningCoachingBriefV1 {
  const outcome = mapSpineOutcomeToBriefOutcome(input.truth_spine.latest_outcome);
  const latestTruth =
    input.truth_spine.latest_outcome_message ??
    (outcome === "no_recent_evidence" ? null : "unknown");

  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "low",
    human_situation: {
      most_alive: "unknown",
      direct_question_or_need: "unknown",
      relevant_life_event: "unknown",
      context_use: "unknown",
      identity_use: "unknown",
      person_use: "unknown",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: latestTruth,
      outcome,
      evidence_note: "unknown",
      evidence_strength: input.truth_spine.evidence_strength,
      consistency_supported: input.truth_spine.consistency_supported,
      proof_claims_allowed: { ...input.truth_spine.proof_claims_allowed },
    },
    conversation_continuity: {
      already_acknowledged: "unknown",
      answered_question: "unknown",
      open_loop: "unknown",
      stale_or_exhausted_topics: "unknown",
      do_not_repeat: "unknown",
    },
    goal_role_today: {
      canonical_goal: input.canonical_goal.text,
      pending_goal: input.pending_goal_change
        ? {
            candidate_text: input.pending_goal_change.candidate_text,
            status: input.pending_goal_change.status,
          }
        : null,
      goal_alignment: buildFailSoftGoalAlignmentFromCanonical(input),
      role: "unknown",
      note: "unknown",
    },
    coaching_direction: {
      primary_move: "unknown",
      question_policy: "unknown",
      action_guidance: "unknown",
      pressure: "unknown",
    },
    boundaries: buildFixedMorningBriefBoundaries({
      pendingGoal: input.pending_goal_change,
    }),
  };
}

function selectedPersonMatchesCanonical(
  selected: { name: string; relationship: string } | null,
  people: MorningBriefInterpreterInputV1["available_important_people"]
): { name: string; relationship: string } | null {
  if (!selected) return null;
  const nameKey = selected.name.trim().toLowerCase();
  const relKey = selected.relationship.trim().toLowerCase();
  const match = people.find(
    (p) =>
      p.name.trim().toLowerCase() === nameKey &&
      p.relationship.trim().toLowerCase() === relKey
  );
  return match ? { name: match.name, relationship: match.relationship } : null;
}

/**
 * Merge interpreter semantic judgment with hard canonical overwrites.
 */
export function mergeMorningBriefWithCanonicalTruth(args: {
  parsed: MorningCoachingBriefV1;
  input: MorningBriefInterpreterInputV1;
}): MorningCoachingBriefV1 {
  const { parsed, input } = args;
  const spineOutcome = mapSpineOutcomeToBriefOutcome(input.truth_spine.latest_outcome);

  const selected_person = selectedPersonMatchesCanonical(
    parsed.human_situation.selected_person,
    input.available_important_people
  );

  const interpreterClaims = parsed.boundaries.claims_to_avoid;
  const interpreterTopics = parsed.boundaries.topics_not_to_force;

  return {
    ...parsed,
    version: MORNING_COACHING_BRIEF_VERSION,
    human_situation: {
      ...parsed.human_situation,
      selected_person,
      selected_person_reason: selected_person
        ? parsed.human_situation.selected_person_reason
        : null,
      person_use: selected_person
        ? parsed.human_situation.person_use
        : parsed.human_situation.person_use === "relevant"
          ? "do_not_force"
          : parsed.human_situation.person_use,
    },
    truth_and_evidence: {
      latest_user_truth:
        input.truth_spine.latest_outcome_message ??
        (input.truth_spine.latest_outcome == null
          ? null
          : parsed.truth_and_evidence.latest_user_truth),
      outcome: spineOutcome,
      evidence_note: parsed.truth_and_evidence.evidence_note,
      evidence_strength: input.truth_spine.evidence_strength,
      consistency_supported: input.truth_spine.consistency_supported,
      proof_claims_allowed: { ...input.truth_spine.proof_claims_allowed },
    },
    goal_role_today: {
      ...parsed.goal_role_today,
      canonical_goal: input.canonical_goal.text,
      pending_goal: input.pending_goal_change
        ? {
            candidate_text: input.pending_goal_change.candidate_text,
            status: input.pending_goal_change.status,
          }
        : null,
      // Pending is always pending_confirmation; otherwise keep interpreter alignment
      // but never allow pending to be treated as confirmed alignment.
      goal_alignment: input.pending_goal_change
        ? "pending_confirmation"
        : parsed.goal_role_today.goal_alignment === "pending_confirmation"
          ? "unknown"
          : parsed.goal_role_today.goal_alignment,
      role: input.pending_goal_change
        ? parsed.goal_role_today.role === "central"
          ? "unresolved"
          : parsed.goal_role_today.role
        : parsed.goal_role_today.role,
    },
    boundaries: buildFixedMorningBriefBoundaries({
      pendingGoal: input.pending_goal_change,
      extraClaimsToAvoid: interpreterClaims,
      extraTopicsNotToForce: interpreterTopics,
    }),
  };
}

export function buildMorningBriefInterpreterUserMessage(
  input: MorningBriefInterpreterInputV1
): string {
  return [
    "MORNING_BRIEF_INTERPRETER_INPUT_V1",
    JSON.stringify(input),
    "",
    "Return JSON only for morning_coaching_brief_v1. No SMS body.",
  ].join("\n");
}

export function buildMorningBriefInterpreterMessages(
  input: MorningBriefInterpreterInputV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT },
    { role: "user", content: buildMorningBriefInterpreterUserMessage(input) },
  ];
}

/**
 * Parse raw model JSON and merge canonical overwrites.
 * Invalid / forbidden-copy responses return null (caller uses fail-soft brief).
 */
export function parseAndMergeMorningBriefInterpreterResponse(args: {
  raw: string;
  input: MorningBriefInterpreterInputV1;
}): MorningCoachingBriefV1 | null {
  let json: unknown;
  try {
    json = JSON.parse(args.raw) as unknown;
  } catch {
    return null;
  }
  const parsed = parseMorningCoachingBriefV1(json);
  if (!parsed) return null;
  return mergeMorningBriefWithCanonicalTruth({ parsed, input: args.input });
}

function buildCapture(args: {
  input: MorningBriefInterpreterInputV1;
  raw: string | null;
  brief: MorningCoachingBriefV1 | null;
  error: string | null;
}): MorningBriefInterpreterCaptureV1 {
  const messages = buildMorningBriefInterpreterMessages(args.input);
  return {
    model: MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL,
    temperature: MORNING_BRIEF_INTERPRETER_TEMPERATURE,
    max_tokens: MORNING_BRIEF_INTERPRETER_MAX_TOKENS,
    prompt_path: MORNING_BRIEF_INTERPRETER_PROMPT_PATH,
    system_message: String(messages[0]?.content ?? ""),
    user_message: String(messages[1]?.content ?? ""),
    canonical_input: args.input,
    raw_response: args.raw,
    parsed_brief: args.brief,
    error: args.error,
  };
}

/**
 * Optional OpenAI call wrapper. Not imported by production generation in Phase 2B.
 * allowRetry: false — no retry loop. Fail-soft to low-confidence unknowns + canonical facts.
 */
export async function runMorningBriefInterpreterV1(args: {
  input: MorningBriefInterpreterInputV1;
  /** Injected client for tests; defaults to env OPENAI_API_KEY. */
  client?: OpenAI | null;
}): Promise<MorningBriefInterpreterResultV1> {
  const failSoft = (error: string, raw: string | null): MorningBriefInterpreterResultV1 => {
    const brief = buildLowConfidenceUnknownBriefFromCanonical(args.input);
    return {
      ok: false,
      brief,
      error,
      capture: buildCapture({
        input: args.input,
        raw,
        brief,
        error,
      }),
    };
  };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    args.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : args.client;

  if (!client) {
    return failSoft("openai_unavailable", null);
  }

  const messages = buildMorningBriefInterpreterMessages(args.input);

  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<MorningCoachingBriefV1>({
      client,
      model: MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL,
      temperature: MORNING_BRIEF_INTERPRETER_TEMPERATURE,
      maxTokens: MORNING_BRIEF_INTERPRETER_MAX_TOKENS,
      primaryMessages: messages,
      allowRetry: false,
      jsonSchemaReminder: `Return strict JSON only for version "${MORNING_COACHING_BRIEF_VERSION}" with no body/sms_body/message/final_message/reply keys.`,
      parse: (raw) => parseAndMergeMorningBriefInterpreterResponse({ raw, input: args.input }),
    });

    if (jsonOut.value) {
      return {
        ok: true,
        brief: jsonOut.value,
        capture: buildCapture({
          input: args.input,
          raw: jsonOut.raw,
          brief: jsonOut.value,
          error: null,
        }),
      };
    }

    return failSoft("invalid_json_or_schema", jsonOut.raw || null);
  } catch {
    return failSoft("openai_request_failed", null);
  }
}

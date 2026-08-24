/**
 * Morning Brief Interpreter V1 — constrained OpenAI semantic judgment.
 * Outputs structured Brief only. No SMS body. No DB mutation.
 * Phase 2C: wired observationally into Morning generation (does not feed writer).
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  MORNING_COACHING_BRIEF_VERSION,
  parseMorningCoachingBriefV1,
  type MorningBriefGoalAlignment,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";
import {
  buildMorningBriefExactContractPromptAppendix,
  MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
} from "@/lib/morning-tto-coaching-brief-json-schema-v1";
import {
  mapSpineOutcomeToBriefOutcome,
  type MorningBriefInterpreterInputV1,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
import { clampProactiveDecision } from "@/lib/sms-proactive-relationship-touch";

/**
 * Phase 2C locked interpreter model — quality-first.
 * Chat Completions + strict JSON Schema; reasoning_effort low.
 * Shared lane JSON helper is incompatible (forces temperature/max_tokens) — call API directly.
 */
export const MORNING_BRIEF_INTERPRETER_MODEL = "gpt-5.6-sol" as const;
export const MORNING_BRIEF_INTERPRETER_REASONING_EFFORT = "low" as const;
/** Not sent to gpt-5.6-sol (temperature unsupported for this model on Chat Completions). */
export const MORNING_BRIEF_INTERPRETER_TEMPERATURE = null;
export const MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS = 2500 as const;
export const MORNING_BRIEF_INTERPRETER_PROMPT_PATH =
  "morning_brief_interpreter_v1" as const;
export const MORNING_BRIEF_INTERPRETER_CAPTURE_VERSION =
  "morning_brief_interpreter_capture_v1" as const;

/** @deprecated Phase 2B name — alias of locked Phase 2C model. */
export const MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL = MORNING_BRIEF_INTERPRETER_MODEL;
/** @deprecated Not used in API request for gpt-5.6-sol. */
export const MORNING_BRIEF_INTERPRETER_MAX_TOKENS =
  MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS;

export const MORNING_BRIEF_INTERPRETER_SCHEMA_RETRY_USER =
  `Your previous response did not match morning_coaching_brief_v1. Return ONLY valid JSON for that exact schema (same field names and enum tokens). Do not change coaching meaning — fix structure only. No markdown. No SMS body.`;

export const MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT = `You are a constrained relationship interpreter for Summitt Mindset Coach Pat texts.

Your job is to interpret the human situation from canonical facts and the exact real SMS thread for the intended message target in message_for, then return structured JSON only.

Hard rules:
- Interpret the human situation. Use canonical facts as hard boundaries.
- message_for (local_date, local_weekday, daypart, timezone) is the authoritative target for this interpretation — not the wall-clock time when generation ran.
- Canonical outcome, proof claims, evidence strength, consistency, Current Goal, and pending goal state win over any guess.
- Identity is context, not proof of action.
- Important people may be selected only when naturally relevant to the live conversation.
- Never name-drop people or identity to prove memory.
- Current Goal is context, not a compulsory subject for every text.
- Meaningful life moments (family, faith, grief, work, celebration, or other real life updates) may outrank Current Goal discussion for this message_for day.
- Answer direct user questions when present.
- Prior coach messages are conversation history, not style examples.
- Choose one primary coaching move.
- At most one useful question (question_policy none or one_useful_question).
- Do not manufacture engagement, topics, or coaching energy just because a proactive text exists for this message_for target.
- Prefer honest unknown / unclear / none / do_not_use over forced coaching interpretation or guessing.
- Output JSON only matching the Coaching Brief schema (version "${MORNING_COACHING_BRIEF_VERSION}").
- Never output user-visible SMS copy.
- Never include keys: body, sms_body, message, final_message, reply.
- Never mutate state. You do not change goals, identity, people, proof, outcomes, or timing.
- coaching_direction.proactive_decision is send or intentional_space. It is the only send/space judgment. send includes both normal conversational coaching and standalone value.
- When mechanical.quiet_relationship_eligible is not true, proactive_decision must be send.
- selected_person must be null or exactly one person from available_important_people (same name and relationship).
- Do not invent outcomes, proof, or pending confirmation.
- version must be "${MORNING_COACHING_BRIEF_VERSION}".
- Silence or unanswered coach texts alone do not prove disengagement when the user previously asked for ongoing motivational support — read the exact thread.
- Do not invent miss/progress/consistency from daypart or unanswered outbounds alone.

TEMPORAL POSTURE (message_for.daypart — shared Morning and Evening):
- Morning (daypart=morning): treat the target as a beginning-of-day receive context. Do not reason as if today's outcome is already known unless exact thread, evidence, and timing actually support that. Morning may answer, reconnect, acknowledge yesterday, prepare for later today, challenge, clarify, celebrate prior proof, ask one useful question, or ask none — it does not automatically mean "make a plan."
- Evening (daypart=evening): treat the target as a near-end-of-day receive context. Avoid start-of-day framing (generic fresh planning for a day already underway or when an earlier plan/open loop already exists). Evening may answer, follow an open loop, ask about what happened today, support, clarify, reconnect, prepare for tomorrow, challenge, ask one useful question, or ask none — it does not automatically mean "the day is over."
- Late opportunity: evening alone must not imply every goal/action opportunity has already happened. If timing/context points to a later-night action, do not invent a miss or demand completion evidence merely because it is evening — use actual timing, context, and evidence.
- Relative time: words like today / tonight / tomorrow / yesterday / this morning / this afternoon / this evening / last night in older turns belong to that turn's local timestamp and day_relation_to_message — do not blindly re-anchor them to the new message_for target.
- Evidence: daypart alone never creates evidence of completion, miss, attempt, consistency, failure, or success.

QUIET RELATIONSHIP VALUE
When mechanical.quiet_relationship_eligible is true (member has not replied for at least 10 days, or has never replied despite meaningful outbound history), additional proactive options become available. Quiet eligibility expands the available coaching moves. It does not force a passive posture.

Do not treat elapsed silence alone as evidence that conversation should stop, that the member is disengaged, struggling, avoiding, failing, preferring no questions, or that Current Goal missed.

Consider the full relationship: prior engagement, whether they historically replied, whether they welcomed accountability, meaningful recent life events, known temporary context such as travel/vacation, unresolved real threads, open loops, recent explicit plans, what Coach has already asked, and whether a natural reentry question would actually add value.

If the member was previously engaged, there is a meaningful recent life event, a real unresolved conversational thread, or a grounded reason to reopen conversation, normal conversational coaching or one useful reentry question may be the best move. A previously engaged member on a known trip is not the same as someone who has never replied.

If the relationship has become genuinely one-way and repeated questions/check-ins add little value, broaden how Coach serves the person using grounded identity, responsibilities, important relationships, life context, and prior conversation. Known roles/identity are domains for useful wisdom, not evidence of current circumstances, feelings, problems, or behavior.

North Star: would this person be glad this text appeared on their phone even if they had absolutely no intention of replying?

Standalone value may include principles, perspectives, advice, small challenges, and standards. Do not fabricate quotes, studies, statistics, or attributed sayings. Prefer giving over asking WHEN conversation has become genuinely one-way — but do not suppress a genuinely useful conversational question merely because 10 days elapsed. Do not turn prefer-giving into never-ask.

Avoid repeated just-checking-in, how-are-you, thinking-of-you, I'm-here-whenever, no-pressure, generic well-wishes, and generic door-open language. Do not force stale Current Goal discussion.

If there is no genuinely useful grounded message worth adding today: proactive_decision = intentional_space.

When mechanical.message_required_today is true: intentional_space is unavailable. Choose send and find the best grounded value or conversational move available. Do not mention silence length, cadence, anti-ghost logic, required touch, or internal system decisions.

When mechanical.quiet_relationship_eligible is not true: existing live-relationship laws remain controlling. Continue conversation, close loops, answer questions, discuss Current Goal when relevant, challenge appropriately, and ask one useful question when appropriate. Do not convert active coaching into passive inspirational copy.

Return a single JSON object with sections: version, confidence, human_situation, truth_and_evidence, conversation_continuity, goal_role_today, coaching_direction, boundaries.

${buildMorningBriefExactContractPromptAppendix()}`;


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
  capture_version: typeof MORNING_BRIEF_INTERPRETER_CAPTURE_VERSION;
  model: typeof MORNING_BRIEF_INTERPRETER_MODEL;
  /** null — temperature is not sent for gpt-5.6-sol. */
  temperature: null;
  reasoning_effort: typeof MORNING_BRIEF_INTERPRETER_REASONING_EFFORT;
  max_completion_tokens: typeof MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS;
  prompt_path: typeof MORNING_BRIEF_INTERPRETER_PROMPT_PATH;
  system_message: string;
  user_message: string;
  canonical_input: MorningBriefInterpreterInputV1;
  /** Exact primary model content (structured-output JSON string when present). */
  raw_response: string | null;
  /** Exact retry model content when a technical schema retry ran. */
  raw_retry_response: string | null;
  /**
   * Successfully parsed+merged Brief from model output only.
   * null when schema/JSON failed — writer may still use a separate fail-soft Brief.
   */
  parsed_brief: MorningCoachingBriefV1 | null;
  error: string | null;
  /** Scrubbed thrown-request diagnostics; null when no throw or unavailable. */
  openai_error: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
  /** @deprecated Prefer retry_occurred / raw_retry_response. Always null for older readers. */
  retry: null;
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
      proactive_decision: "send",
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
    coaching_direction: {
      ...parsed.coaching_direction,
      proactive_decision: clampProactiveDecision({
        decision: parsed.coaching_direction.proactive_decision,
        quietRelationshipEligible: input.mechanical.quiet_relationship_eligible === true,
        messageRequiredToday: input.mechanical.message_required_today === true,
      }),
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

/** Classify why a raw response did not become a Brief (no meaning rewrite). */
export function classifyMorningBriefInterpreterParseFailure(
  raw: string | null
): "invalid_json" | "schema_validation_failed" {
  if (!raw?.trim()) return "invalid_json";
  try {
    JSON.parse(raw);
  } catch {
    return "invalid_json";
  }
  return "schema_validation_failed";
}

function buildCapture(args: {
  input: MorningBriefInterpreterInputV1;
  raw: string | null;
  raw_retry_response?: string | null;
  /** Model-parsed brief only — null on fail-soft. */
  brief: MorningCoachingBriefV1 | null;
  error: string | null;
  openai_error?: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred?: boolean;
  retry_succeeded?: boolean | null;
}): MorningBriefInterpreterCaptureV1 {
  const messages = buildMorningBriefInterpreterMessages(args.input);
  return {
    capture_version: MORNING_BRIEF_INTERPRETER_CAPTURE_VERSION,
    model: MORNING_BRIEF_INTERPRETER_MODEL,
    temperature: null,
    reasoning_effort: MORNING_BRIEF_INTERPRETER_REASONING_EFFORT,
    max_completion_tokens: MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
    prompt_path: MORNING_BRIEF_INTERPRETER_PROMPT_PATH,
    system_message: String(messages[0]?.content ?? ""),
    user_message: String(messages[1]?.content ?? ""),
    canonical_input: args.input,
    raw_response: args.raw,
    raw_retry_response: args.raw_retry_response ?? null,
    parsed_brief: args.brief,
    error: args.error,
    openai_error: args.openai_error ?? null,
    request_started_at: args.request_started_at,
    request_completed_at: args.request_completed_at,
    latency_ms: args.latency_ms,
    retry_occurred: args.retry_occurred === true,
    retry_succeeded:
      args.retry_succeeded === undefined ? null : args.retry_succeeded,
    retry: null,
  };
}

/**
 * OpenAI call wrapper. Fail-soft never blocks writer.
 * Uses Chat Completions + strict json_schema for gpt-5.6-sol.
 * At most one technical schema-format retry (same model, structure-only).
 */
export async function runMorningBriefInterpreterV1(args: {
  input: MorningBriefInterpreterInputV1;
  /** Injected client for tests; defaults to env OPENAI_API_KEY. */
  client?: OpenAI | null;
}): Promise<MorningBriefInterpreterResultV1> {
  const failSoft = (
    error: string,
    raw: string | null,
    timing?: {
      request_started_at: string | null;
      request_completed_at: string | null;
      latency_ms: number | null;
    },
    retryMeta?: {
      raw_retry_response: string | null;
      retry_occurred: boolean;
      retry_succeeded: boolean | null;
    },
    openai_error?: ScrubbedOpenAiRequestError | null
  ): MorningBriefInterpreterResultV1 => {
    const brief = buildLowConfidenceUnknownBriefFromCanonical(args.input);
    return {
      ok: false,
      brief,
      error,
      capture: buildCapture({
        input: args.input,
        raw,
        raw_retry_response: retryMeta?.raw_retry_response ?? null,
        // Forensic: do not present fail-soft as a successful model parse.
        brief: null,
        error,
        openai_error: openai_error ?? null,
        request_started_at: timing?.request_started_at ?? null,
        request_completed_at: timing?.request_completed_at ?? null,
        latency_ms: timing?.latency_ms ?? null,
        retry_occurred: retryMeta?.retry_occurred ?? false,
        retry_succeeded: retryMeta?.retry_succeeded ?? null,
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
  const startedMs = Date.now();
  const request_started_at = new Date(startedMs).toISOString();

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: MORNING_BRIEF_INTERPRETER_MODEL,
      reasoning_effort: MORNING_BRIEF_INTERPRETER_REASONING_EFFORT,
      max_completion_tokens: MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
      response_format: MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
      messages: msgs,
    });

  try {
    const first = await solCreate(messages);
    let raw = first.choices[0]?.message?.content?.trim() ?? "";
    let merged = raw
      ? parseAndMergeMorningBriefInterpreterResponse({ raw, input: args.input })
      : null;

    let rawRetry: string | null = null;
    let retryOccurred = false;

    if (!merged) {
      retryOccurred = true;
      const retryMessages: ChatCompletionMessageParam[] = [
        { role: "assistant", content: raw.slice(0, 8000) },
        { role: "user", content: MORNING_BRIEF_INTERPRETER_SCHEMA_RETRY_USER },
      ];
      const second = await solCreate([...messages, ...retryMessages]);
      rawRetry = second.choices[0]?.message?.content?.trim() ?? "";
      merged = rawRetry
        ? parseAndMergeMorningBriefInterpreterResponse({
            raw: rawRetry,
            input: args.input,
          })
        : null;
    }

    const completedMs = Date.now();
    const request_completed_at = new Date(completedMs).toISOString();
    const latency_ms = completedMs - startedMs;
    const timing = { request_started_at, request_completed_at, latency_ms };

    if (merged) {
      return {
        ok: true,
        brief: merged,
        capture: buildCapture({
          input: args.input,
          raw,
          raw_retry_response: rawRetry,
          brief: merged,
          error: null,
          ...timing,
          retry_occurred: retryOccurred,
          retry_succeeded: retryOccurred ? true : null,
        }),
      };
    }

    const failRaw = rawRetry ?? raw;
    return failSoft(
      classifyMorningBriefInterpreterParseFailure(failRaw),
      raw || null,
      timing,
      {
        raw_retry_response: rawRetry,
        retry_occurred: retryOccurred,
        retry_succeeded: retryOccurred ? false : null,
      }
    );
  } catch (err) {
    const completedMs = Date.now();
    return failSoft(
      "openai_request_failed",
      null,
      {
        request_started_at,
        request_completed_at: new Date(completedMs).toISOString(),
        latency_ms: completedMs - startedMs,
      },
      undefined,
      scrubOpenAiRequestErrorForCapture(err)
    );
  }
}

/** Shape persisted under generation_metadata.morning_brief_interpreter_v1 */
export function buildMorningBriefInterpreterMetadataV1(
  capture: MorningBriefInterpreterCaptureV1
): Record<string, unknown> {
  return {
    capture_version: capture.capture_version,
    model: capture.model,
    temperature: capture.temperature,
    reasoning_effort: capture.reasoning_effort,
    max_completion_tokens: capture.max_completion_tokens,
    prompt_path: capture.prompt_path,
    request_started_at: capture.request_started_at,
    request_completed_at: capture.request_completed_at,
    latency_ms: capture.latency_ms,
    exact_system_message: capture.system_message,
    exact_user_message: capture.user_message,
    exact_input_object: capture.canonical_input,
    raw_response: capture.raw_response,
    raw_retry_response: capture.raw_retry_response,
    parsed_brief: capture.parsed_brief,
    error: capture.error,
    openai_error: capture.openai_error,
    retry_occurred: capture.retry_occurred,
    retry_succeeded: capture.retry_succeeded,
    retry: null,
  };
}

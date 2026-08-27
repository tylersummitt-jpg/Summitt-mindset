/**
 * Weekly TTO Brief interpreter — GPT-5.6 Sol, reasoning_effort low, strict JSON, one schema retry.
 * Reuses morning_coaching_brief_v1 schema/parser. No SMS body. No should_send. No DB mutation.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  assembleMorningBriefInterpreterInputFromPacket,
  loadMorningBriefCanonicalExtrasV1,
} from "@/lib/morning-tto-brief-canonical-load-v1";
import type { MorningBriefInterpreterInputV1 } from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
  MORNING_BRIEF_INTERPRETER_MODEL,
  MORNING_BRIEF_INTERPRETER_REASONING_EFFORT,
  MORNING_BRIEF_INTERPRETER_SCHEMA_RETRY_USER,
  MORNING_BRIEF_INTERPRETER_TEMPERATURE,
  buildLowConfidenceUnknownBriefFromCanonical,
  classifyMorningBriefInterpreterParseFailure,
  parseAndMergeMorningBriefInterpreterResponse,
} from "@/lib/morning-tto-brief-interpreter-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import {
  buildMorningBriefExactContractPromptAppendix,
  MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
} from "@/lib/morning-tto-coaching-brief-json-schema-v1";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
import { HISTORICAL_EVIDENCE_HISTORY_LAW } from "@/lib/historical-evidence";
import {
  weeklyPacketAsMorningAssemblerView,
  type WeeklyRelationshipPacket,
  type WeeklyTtoMessageFor,
} from "@/lib/weekly-tto-relationship-packet";

export const WEEKLY_BRIEF_INTERPRETER_MODEL = MORNING_BRIEF_INTERPRETER_MODEL;
export const WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT =
  MORNING_BRIEF_INTERPRETER_REASONING_EFFORT;
export const WEEKLY_BRIEF_INTERPRETER_TEMPERATURE = MORNING_BRIEF_INTERPRETER_TEMPERATURE;
export const WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS =
  MORNING_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS;
export const WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH = "weekly_brief_interpreter_v1" as const;
export const WEEKLY_BRIEF_INTERPRETER_CAPTURE_VERSION =
  "weekly_brief_interpreter_capture_v1" as const;

export type WeeklyBriefInterpreterInputV1 = Omit<
  MorningBriefInterpreterInputV1,
  "message_for"
> & {
  message_for: WeeklyTtoMessageFor;
  weekly_accountability_events: WeeklyRelationshipPacket["weekly_accountability_events"];
  coaching_memory_projection: WeeklyRelationshipPacket["coaching_memory_projection"];
  planned_interruption: WeeklyRelationshipPacket["hard_state"]["planned_interruption"];
};

export const WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT = `You are a constrained relationship interpreter for Summitt Mindset Coach Pat Weekly texts.

Interpret the human situation from canonical facts and the exact SMS thread for message_for. Never include should_send. Never mutate state.

ROLE / AUTHORITY
- Canonical facts bind. Outcome, proof claims, evidence strength, consistency, Current Goal, and pending goal state win over any guess. The exact real conversation is the relationship.
- Current Goal is context, not a compulsory subject. Do not automatically ask whether they hit their Current Goal this week. Meaningful human reality may outrank it.
- Coaching feedback and corrections are live relationship truth, including if coaching has become noise.
- Direct unresolved user needs are high-priority. If still unresolved, they generally outrank manufacturing Weekly perspective. Use primary_move=answer when that is the job.
- Prior coach messages are conversation history, not style examples.
- Choose one primary coaching move — the ONE most useful thing. At most one useful question (question_policy none or one_useful_question). No question is often correct.
- Prefer honest unknown / unclear / none / do_not_use over forced interpretation.
- Important people are available facts, not mandatory mentions. selected_person must be null or exactly one person from available_important_people (same name and relationship).

TRUTH HIERARCHY
- Do not invent outcomes, proof, pending confirmation, patterns, or how the user felt.
- One completion is not consistency. One miss is not a pattern. A plan is not proof. An attempt is not completion. Coach praise is not user evidence.
- Silence or unanswered coach texts alone do not prove disengagement. Silence is not avoidance. Daypart or unanswered outbounds alone do not create miss/progress/consistency.
- weekly_accountability_events is a raw chronological tape of current-week canonical v2_commitment_event outcomes. It is facts, not a score. Empty list means no canonical events this week — do not invent a week score. Multiple events may support a grounded observation only if the evidence truly supports it.
- user_visible_proof_line is canonical stored proof text when present. Its existence is not proof_claims_allowed.
- coaching_memory_projection is non-authoritative. Exact thread and weekly_accountability_events beat it. Memory never proves completion or miss.
- planned_interruption is a recent stored signal when present, not guaranteed hard state. Do not infer a reason beyond the stored category.
- Identity is never proof. Identity may be connected to concrete evidence when the week genuinely demonstrates who they said they want to be. Do not quote or name-drop identity merely because it is available.

HISTORICAL EVIDENCE
${HISTORICAL_EVIDENCE_HISTORY_LAW}

RELATIONSHIP CONTINUITY
- Do not re-ask a stale or unanswered Coach question in different words. If it is stale, mark it stale in conversation_continuity.

UNRESOLVED COACHING-FOCUS CHOICE
If Coach has explicitly asked the member to choose whether to continue, change, pause, or redefine the current coaching focus / Current Goal, and the member has not answered that choice, preserve the unresolved choice. Read that meaning from the exact thread. Do not use a phrase list.

Current Goal remains canonical state until existing pending/inbound confirmation changes it. Do not mutate it. Do not invent pending confirmation. Do not set goal_alignment to pending_confirmation unless pending_goal_change is actually present.

Do not recap or coach the disputed focus as though it was reaffirmed. Do not assign new work on that disputed focus merely because it remains canonical. Prefer goal_role_today.role unresolved or background, goal_alignment unknown or possibly_stale, and action_guidance none unless the exact thread contains an independent reason to continue a live practical thread (a later user turn about that work, a distinct user request, or a separate live operational thread). Keep the unanswered choice in conversation_continuity.open_loop. Do not re-ask the same coaching-focus choice.

This law does not freeze ordinary unanswered outcome questions, ordinary life questions, operational detail questions, or unanswered coaching-method menus. Weekly remains send-only: coaching_direction.proactive_decision must be send. Do not use intentional_space. Reconnect, perspective, support, useful Sunday value, and independent live threads remain legal.

SUNDAY-NOON TEMPORAL POSTURE
- message_for (local_date, local_weekday, daypart=weekly, timezone, week_start_local_date, week_end_local_date) is the only clock. Ignore generation wall-clock, including Friday/Saturday generation.
- This text is for Sunday around noon local time. Sunday is still in progress. The current week is nearing its close. Monday has not begun. The user still has the rest of Sunday. Looking backward or forward is allowed; neither is required.
- Older relative-time words belong to their original timestamps and day_relation_to_message. Do not call an earlier-week event "today" unless Sunday timing actually supports it.
- Do not frame this as a morning start-of-day, an evening end-of-day recap, or Monday already beginning. Sunday noon is not "how was your day?" and the day is not over.

WEEKLY PERSPECTIVE DECISION
- The wider week is a lens, not an assignment. Use it only when looking across multiple moments, or one meaningful arc, reveals something useful that is not obvious from the latest turn alone.
- Prefer synthesis over summary. Synthesis names meaning, a shift, what repeated evidence suggests, a comeback, what changed, or what is worth carrying forward. Summary lists days, replays the week, or reports events back. Not a newsletter, survey, or report. Do not enumerate the week.
- Do not force synthesis. A good Weekly interpretation may conclude that nothing useful needs to be extracted from the week. That is not a failure. Stay with the latest human reality. Do not manufacture a lesson, pattern, takeaway, recap, or reflection simply because it is Sunday.
- If weekly perspective is earned, primary_move may be offer_perspective. Do not force offer_perspective or simplify_next_move. If nothing is worth extracting, use another existing primary_move. question_policy may still be none.
- If one useful thing is genuinely worth carrying into Monday or the coming week, it may shape coaching_direction. Do not create a next-week plan merely because it is Sunday. Carry-forward, rest, leaving Monday for Monday, one question, or none are all valid.

OUTPUT CONTRACT
- Never include keys: body, sms_body, message, final_message, reply, should_send.
- You do not change goals, identity, people, proof, outcomes, or timing.
- coaching_direction.proactive_decision must be send. Weekly does not use intentional_space.

${buildMorningBriefExactContractPromptAppendix()}`;

export type WeeklyBriefInterpreterCaptureV1 = {
  capture_version: typeof WEEKLY_BRIEF_INTERPRETER_CAPTURE_VERSION;
  model: typeof WEEKLY_BRIEF_INTERPRETER_MODEL;
  temperature: null;
  reasoning_effort: typeof WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT;
  max_completion_tokens: typeof WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS;
  prompt_path: typeof WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH;
  system_message: string;
  user_message: string;
  canonical_input: WeeklyBriefInterpreterInputV1;
  raw_response: string | null;
  raw_retry_response: string | null;
  parsed_brief: MorningCoachingBriefV1 | null;
  error: string | null;
  openai_error: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
};

export type WeeklyBriefInterpreterResultV1 =
  | {
      ok: true;
      brief: MorningCoachingBriefV1;
      capture: WeeklyBriefInterpreterCaptureV1;
      input: WeeklyBriefInterpreterInputV1;
    }
  | {
      ok: false;
      brief: MorningCoachingBriefV1;
      capture: WeeklyBriefInterpreterCaptureV1;
      input: WeeklyBriefInterpreterInputV1 | null;
      error: string;
    };

function weeklyInputAsMorningMergeView(
  input: WeeklyBriefInterpreterInputV1
): MorningBriefInterpreterInputV1 {
  return {
    ...input,
    message_for: {
      timezone: input.message_for.timezone,
      local_date: input.message_for.local_date,
      local_weekday: input.message_for.local_weekday,
      daypart: "morning",
    },
    mechanical: {
      ...input.mechanical,
      quiet_relationship_eligible: false,
      message_required_today: false,
    },
  };
}

function weeklyTapeFieldsFromPacket(packet: WeeklyRelationshipPacket): Pick<
  WeeklyBriefInterpreterInputV1,
  "weekly_accountability_events" | "coaching_memory_projection" | "planned_interruption"
> {
  return {
    weekly_accountability_events: packet.weekly_accountability_events,
    coaching_memory_projection: packet.coaching_memory_projection,
    planned_interruption: packet.hard_state.planned_interruption,
  };
}

export function assembleWeeklyBriefInterpreterInputFromPacket(args: {
  packet: WeeklyRelationshipPacket;
  extras: Awaited<ReturnType<typeof loadMorningBriefCanonicalExtrasV1>>;
}): WeeklyBriefInterpreterInputV1 | { ok: false; error: string } {
  const assembled = assembleMorningBriefInterpreterInputFromPacket({
    packet: weeklyPacketAsMorningAssemblerView(args.packet),
    extras: args.extras,
    messageRequiredToday: false,
    quietRelationshipEligible: false,
  });
  if ("ok" in assembled) return assembled;
  return {
    ...assembled,
    message_for: args.packet.message_for,
    ...weeklyTapeFieldsFromPacket(args.packet),
  };
}

export function buildWeeklyBriefInterpreterUserMessage(
  input: WeeklyBriefInterpreterInputV1
): string {
  return [
    "WEEKLY_BRIEF_INTERPRETER_INPUT_V1",
    JSON.stringify(input),
    "",
    "Interpret this Sunday Weekly moment from canonical facts and exact_thread.",
    "Return JSON only for morning_coaching_brief_v1. No SMS body. No should_send.",
  ].join("\n");
}

export function buildWeeklyBriefInterpreterMessages(
  input: WeeklyBriefInterpreterInputV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT },
    { role: "user", content: buildWeeklyBriefInterpreterUserMessage(input) },
  ];
}

function buildCapture(args: {
  input: WeeklyBriefInterpreterInputV1;
  raw: string | null;
  raw_retry_response?: string | null;
  brief: MorningCoachingBriefV1 | null;
  error: string | null;
  openai_error?: ScrubbedOpenAiRequestError | null;
  request_started_at: string | null;
  request_completed_at: string | null;
  latency_ms: number | null;
  retry_occurred: boolean;
  retry_succeeded: boolean | null;
}): WeeklyBriefInterpreterCaptureV1 {
  const messages = buildWeeklyBriefInterpreterMessages(args.input);
  return {
    capture_version: WEEKLY_BRIEF_INTERPRETER_CAPTURE_VERSION,
    model: WEEKLY_BRIEF_INTERPRETER_MODEL,
    temperature: null,
    reasoning_effort: WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT,
    max_completion_tokens: WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
    prompt_path: WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH,
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
    retry_occurred: args.retry_occurred,
    retry_succeeded: args.retry_succeeded,
  };
}

export function buildWeeklyBriefInterpreterMetadataV1(
  capture: WeeklyBriefInterpreterCaptureV1
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
  };
}

/**
 * Weekly interpreter. Fail-soft Brief on schema/OpenAI failure (same as Morning).
 * Never returns should_send. Never writes SMS.
 */
export async function runWeeklyBriefInterpreterV1(args: {
  packet: WeeklyRelationshipPacket;
  clerkUserId: string;
  commitmentId: string;
  client?: OpenAI | null;
}): Promise<WeeklyBriefInterpreterResultV1> {
  let extras;
  try {
    extras = await loadMorningBriefCanonicalExtrasV1({
      clerkUserId: args.clerkUserId,
      commitmentId: args.commitmentId,
    });
  } catch (e) {
    const emptyInput = null;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "canonical_extras_failed",
      input: emptyInput,
      brief: buildLowConfidenceUnknownBriefFromCanonical({
        version: "morning_brief_interpreter_input_v1",
        message_for: {
          timezone: args.packet.message_for.timezone,
          local_date: args.packet.message_for.local_date,
          local_weekday: args.packet.message_for.local_weekday,
          daypart: "morning",
        },
        mechanical: {
          days_since_last_user_response: args.packet.last_user_response.days_since,
          never_replied: args.packet.last_user_response.never_replied,
          recent_unanswered_outbound_count: 0,
          message_required_today: false,
          quiet_relationship_eligible: false,
        },
        canonical_goal: { text: args.packet.current_goal.text },
        pending_goal_change: args.packet.hard_state.pending_goal_change,
        available_identity: args.packet.current_identity.text
          ? { text: args.packet.current_identity.text }
          : null,
        available_important_people: [],
        available_life_context: [],
        truth_spine: {
          latest_outcome: null,
          latest_outcome_at: null,
          latest_outcome_message: null,
          evidence_strength: "none",
          consistency_supported: false,
          proof_claims_allowed: {
            completion: false,
            miss: false,
            partial: false,
            proof: false,
          },
        },
        thread_memory_hint: null,
        historical_evidence: args.packet.historical_evidence,
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          messages: args.packet.exact_thread.messages,
          omitted_older_turn_count: args.packet.exact_thread.omitted_older_turn_count,
        },
      }),
      capture: {
        capture_version: WEEKLY_BRIEF_INTERPRETER_CAPTURE_VERSION,
        model: WEEKLY_BRIEF_INTERPRETER_MODEL,
        temperature: null,
        reasoning_effort: WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT,
        max_completion_tokens: WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
        prompt_path: WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH,
        system_message: WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT,
        user_message: "",
        canonical_input: {
          version: "morning_brief_interpreter_input_v1",
          message_for: args.packet.message_for,
          mechanical: {
            days_since_last_user_response: args.packet.last_user_response.days_since,
            never_replied: args.packet.last_user_response.never_replied,
            recent_unanswered_outbound_count: 0,
            message_required_today: false,
            quiet_relationship_eligible: false,
          },
          canonical_goal: { text: args.packet.current_goal.text },
          pending_goal_change: args.packet.hard_state.pending_goal_change,
          available_identity: args.packet.current_identity.text
            ? { text: args.packet.current_identity.text }
            : null,
          available_important_people: [],
          available_life_context: [],
          truth_spine: {
            latest_outcome: null,
            latest_outcome_at: null,
            latest_outcome_message: null,
            evidence_strength: "none",
            consistency_supported: false,
            proof_claims_allowed: {
              completion: false,
              miss: false,
              partial: false,
              proof: false,
            },
          },
          thread_memory_hint: null,
          historical_evidence: args.packet.historical_evidence,
          exact_thread: {
            window_days: 21,
            max_messages: 30,
            messages: args.packet.exact_thread.messages,
            omitted_older_turn_count: args.packet.exact_thread.omitted_older_turn_count,
          },
          ...weeklyTapeFieldsFromPacket(args.packet),
        },
        raw_response: null,
        raw_retry_response: null,
        parsed_brief: null,
        error: e instanceof Error ? e.message : "canonical_extras_failed",
        openai_error: null,
        request_started_at: null,
        request_completed_at: null,
        latency_ms: null,
        retry_occurred: false,
        retry_succeeded: null,
      },
    };
  }

  const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
    packet: args.packet,
    extras,
  });
  if ("ok" in assembled) {
    const failInput: WeeklyBriefInterpreterInputV1 = {
      version: "morning_brief_interpreter_input_v1",
      message_for: args.packet.message_for,
      mechanical: {
        days_since_last_user_response: args.packet.last_user_response.days_since,
        never_replied: args.packet.last_user_response.never_replied,
        recent_unanswered_outbound_count: 0,
        message_required_today: false,
        quiet_relationship_eligible: false,
      },
      canonical_goal: { text: args.packet.current_goal.text },
      pending_goal_change: args.packet.hard_state.pending_goal_change,
      available_identity: args.packet.current_identity.text
        ? { text: args.packet.current_identity.text }
        : null,
      available_important_people: [],
      available_life_context: [],
      truth_spine: {
        latest_outcome: null,
        latest_outcome_at: null,
        latest_outcome_message: null,
        evidence_strength: "none",
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      thread_memory_hint: null,
      historical_evidence: args.packet.historical_evidence,
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        messages: args.packet.exact_thread.messages,
        omitted_older_turn_count: args.packet.exact_thread.omitted_older_turn_count,
      },
      ...weeklyTapeFieldsFromPacket(args.packet),
    };
    return {
      ok: false,
      error: assembled.error,
      input: failInput,
      brief: buildLowConfidenceUnknownBriefFromCanonical(
        weeklyInputAsMorningMergeView(failInput)
      ),
      capture: buildCapture({
        input: failInput,
        raw: null,
        brief: null,
        error: assembled.error,
        request_started_at: null,
        request_completed_at: null,
        latency_ms: null,
        retry_occurred: false,
        retry_succeeded: null,
      }),
    };
  }

  const input = assembled;
  const mergeView = weeklyInputAsMorningMergeView(input);

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
  ): WeeklyBriefInterpreterResultV1 => ({
    ok: false,
    error,
    input,
    brief: buildLowConfidenceUnknownBriefFromCanonical(mergeView),
    capture: buildCapture({
      input,
      raw,
      raw_retry_response: retryMeta?.raw_retry_response ?? null,
      brief: null,
      error,
      openai_error: openai_error ?? null,
      request_started_at: timing?.request_started_at ?? null,
      request_completed_at: timing?.request_completed_at ?? null,
      latency_ms: timing?.latency_ms ?? null,
      retry_occurred: retryMeta?.retry_occurred ?? false,
      retry_succeeded: retryMeta?.retry_succeeded ?? null,
    }),
  });

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

  const messages = buildWeeklyBriefInterpreterMessages(input);
  const startedMs = Date.now();
  const request_started_at = new Date(startedMs).toISOString();

  const solCreate = (msgs: ChatCompletionMessageParam[]) =>
    client.chat.completions.create({
      model: WEEKLY_BRIEF_INTERPRETER_MODEL,
      reasoning_effort: WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT,
      max_completion_tokens: WEEKLY_BRIEF_INTERPRETER_MAX_COMPLETION_TOKENS,
      response_format: MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
      messages: msgs,
    });

  try {
    const first = await solCreate(messages);
    let raw = first.choices[0]?.message?.content?.trim() ?? "";
    let merged = raw
      ? parseAndMergeMorningBriefInterpreterResponse({ raw, input: mergeView })
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
            input: mergeView,
          })
        : null;
    }

    const completedMs = Date.now();
    const timing = {
      request_started_at,
      request_completed_at: new Date(completedMs).toISOString(),
      latency_ms: completedMs - startedMs,
    };

    if (merged) {
      return {
        ok: true,
        brief: merged,
        input,
        capture: buildCapture({
          input,
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

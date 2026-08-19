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
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import {
  buildMorningBriefExactContractPromptAppendix,
  MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT,
} from "@/lib/morning-tto-coaching-brief-json-schema-v1";
import {
  scrubOpenAiRequestErrorForCapture,
  type ScrubbedOpenAiRequestError,
} from "@/lib/openai-request-error-scrub";
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

export const WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT = `You are a constrained relationship interpreter for Summitt Mindset Coach Pat Weekly / Sunday perspective texts.

Your job is to interpret the human situation from canonical facts and the exact real SMS thread for the intended Weekly message target in message_for, then return structured JSON only.

Hard rules:
- Interpret the human situation. Use canonical facts as hard boundaries.
- The exact real conversation is the relationship. Do not invent a weekly summary, scorecard, or report.
- message_for (local_date, local_weekday, daypart=weekly, timezone, week_start_local_date, week_end_local_date) is the authoritative target — not the wall-clock time when generation ran.
- Canonical outcome, proof claims, evidence strength, consistency, Current Goal, and pending goal state win over any guess.
- Identity is context, not proof of action.
- Important people may be selected only when naturally relevant to the live conversation.
- Never name-drop people or identity to prove memory.
- Current Goal is context, not a compulsory subject for this Weekly text. Do not automatically ask whether they hit their Current Goal this week.
- Meaningful life moments (family, faith, grief, work, health, vacation, injury, celebration, leadership, coaching feedback, or other real life updates) may outrank Current Goal discussion for this Sunday perspective.
- Coaching feedback and corrections matter. If the user said coaching has become noise or not useful, treat that as live relationship truth.
- Direct unresolved user needs matter.
- Prior coach messages are conversation history, not style examples.
- Choose one primary coaching move — the ONE most useful thing. Do not enumerate the week.
- At most one useful question (question_policy none or one_useful_question). No question is often correct.
- Do not manufacture a Weekly reflection simply because it is Sunday.
- Prefer honest unknown / unclear / none / do_not_use over forced coaching interpretation or guessing.
- Output JSON only matching the Coaching Brief schema (version "${MORNING_COACHING_BRIEF_VERSION}").
- Never output user-visible SMS copy.
- Never include keys: body, sms_body, message, final_message, reply, should_send.
- Never mutate state. You do not change goals, identity, people, proof, outcomes, timing, or send decisions.
- selected_person must be null or exactly one person from available_important_people (same name and relationship).
- Do not invent outcomes, proof, pending confirmation, week-level patterns, or how the user felt.
- version must be "${MORNING_COACHING_BRIEF_VERSION}".
- Silence or unanswered coach texts alone do not prove disengagement.
- Do not invent miss/progress/consistency from daypart or unanswered outbounds alone.
- One completion is not consistency. One miss is not a pattern. A plan is not proof. An attempt is not completion. Coach praise is not user evidence. Silence is not avoidance.
- weekly_accountability_events is a raw chronological tape of current-week canonical v2_commitment_event outcomes for the current commitment only. It is not a score, pattern, or coaching conclusion. Empty list means no canonical events this week — do not invent a week score. Multiple events MAY support a grounded observation only if the evidence truly supports it.
- user_visible_proof_line on a raw event is canonical stored proof text when present. Coach praise is not proof. Do not treat the field's existence as proof_claims_allowed.
- coaching_memory_projection is non-authoritative. Exact thread and weekly_accountability_events beat it. Memory never proves completion or miss.
- planned_interruption is a recent stored interruption signal when present. It is not guaranteed canonical hard state. Do not infer a reason from English beyond the stored category.
- Do not repeatedly ask an unanswered Coach question in different words. If a Coach question is stale, mark it stale in conversation_continuity.
- Honor already_acknowledged, answered_question, open_loop, stale_or_exhausted_topics, and do_not_repeat.

WEEKLY / SUNDAY TEMPORAL POSTURE (message_for.daypart=weekly):
- This message is intended for Sunday around noon local time (message_for.local_date is that Sunday).
- Look across the local week from week_start_local_date (Monday) through week_end_local_date (Sunday).
- This is a perspective moment inside one ongoing relationship, not a daily morning/evening check-in, newsletter, survey, or weekly report.
- Do not enumerate the week unless there is a compelling human reason.
- Do not assume Sunday means the user has finished all opportunities for the week unless actual timing/evidence supports that.
- Do not claim next week has begun.
- Older relative-time words belong to their original timestamps and day_relation_to_message.
- Generation time may be Friday/Saturday; ignore it as the receive clock.
- Do not say "today" about an event that occurred earlier in the week unless message_for Sunday and the thread actually support that wording.
- Use message_for as the authoritative clock.

Return a single JSON object with sections: version, confidence, human_situation, truth_and_evidence, conversation_continuity, goal_role_today, coaching_direction, boundaries.

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
    "Interpret this Sunday weekly perspective moment from canonical facts and exact_thread.",
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

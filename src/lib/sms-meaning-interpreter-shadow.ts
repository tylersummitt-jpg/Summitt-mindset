import OpenAI from "openai";

import {
  getSmsMeaningInterpreterModel,
  getSmsMeaningInterpreterPromptVersion,
  getSmsMeaningInterpreterSampleRate,
  isSmsMeaningInterpreterAmbiguousOnly,
  isSmsMeaningInterpreterShadowEnabled,
  shouldLogMeaningInterpreterBodyPreview,
  shouldSampleMeaningInterpreter,
} from "@/lib/sms-meaning-interpreter-flags";
import {
  buildMeaningInterpreterShadowFinalizeFromSchedule,
  mergeMeaningInterpreterDeterministicFacts,
  parseMeaningInterpreterLastErrorTag,
  type MeaningInterpreterShadowFinalizeInput,
} from "@/lib/sms-meaning-interpreter-context";
import {
  describeMeaningInterpreterShadowValidationFailure,
  parseAndValidateMeaningInterpreterShadow,
  type MeaningInterpreterShadowParsed,
  type MeaningInterpreterShadowValidationFailureDetail,
} from "@/lib/sms-meaning-interpreter-schema";
import { listApprovedSmsPatternCorrectionsForShadowPrompt } from "@/lib/sms-pattern-correction";
import { supabaseServer } from "@/lib/supabase-server";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const OPENAI_TIMEOUT_MS = 12_000;
const INBOUND_TEXT_MAX = 900;
const OUTBOUND_PREVIEW_MAX = 280;
const BEHAVIOR_MAX = 200;
const REPLY_PREVIEW_MAX = 160;

export type MeaningInterpreterShadowStatus = "openai_ok" | "openai_failed" | "skipped";

export type MeaningInterpreterShadowSkipReason =
  | "disabled"
  | "sampled_out"
  | "ambiguous_only_skip"
  | "empty_message"
  | "compliance_turn"
  | "safety_turn"
  | "tapback_suppressed"
  | "suppressed_no_send"
  | "send_failed";

export type MeaningInterpreterDeterministicFacts = {
  classifier_event_type?: string | null;
  classifier_normalized_hint?: string | null;
  gated_mode?: string | null;
  open_question_text?: string | null;
  expected_reply_semantics?: string | null;
  resolution_subkind?: string | null;
  pending_resolution_kind?: string | null;
  pending_applied?: boolean | null;
  pending_cleared?: boolean | null;
  user_answer_type?: string | null;
  season_mutation_kind?: string | null;
  last_outbound_preview?: string | null;
  behavior_statement?: string | null;
  blocker_capture_after_event?: string | null;
  blocker_text_preview?: string | null;
  overlay_action?: string | null;
  rpc_result?: string | null;
  proposal_kind_digest?: string | null;
  inbound_parse?: string | null;
  overlay_consent_pending?: boolean | null;
  refresh_step?: string | null;
  user_answer_token?: string | null;
  memory_pending_kind?: string | null;
  confirmation_parse?: string | null;
  memory_applied?: boolean | null;
  comms_preference_action?: string | null;
  pause_active?: boolean | null;
  cadence_override?: string | null;
  weekend_send_policy?: string | null;
  planned_interruption_category?: string | null;
  skip_reason?: string | null;
  job_final_status?: string | null;
  last_error_tag?: string | null;
  safety_tier?: string | null;
  job_status?: string | null;
  route_purpose?: string | null;
  branch_name?: string | null;
  outcome_sent?: boolean | null;
  latest_coach_question?: string | null;
  open_question_pending?: boolean | null;
  open_question_answer_text?: string | null;
  last_outbound_full_body_preview?: string | null;
  recent_transcript_preview?: string | null;
  effective_ask_preview?: string | null;
  adaptive_proposal_pending?: boolean | null;
  v3_no_send_reason?: string | null;
  v3_lane_stage?: string | null;
  gate_reason?: string | null;
  gate_details?: Record<string, unknown> | null;
  open_question_routing_miss?: boolean | null;
  inbound_preview?: string | null;
  gated_outcome?: string | null;
  contract_consent_gate_miss?: boolean | null;
  /** Shadow S1: sanitized OpenAI/validation failure detail (observability only). */
  shadow_failure_detail?: Record<string, unknown> | null;
};

export type MeaningInterpreterShadowScheduleArgs = {
  deterministicRoute: string;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  commitmentId?: string | null;
  skipReason?: MeaningInterpreterShadowSkipReason;
};

export function buildMeaningShadowScheduleArgs(args: {
  deterministicRoute: string;
  commitmentId?: string | null;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  skipReason?: MeaningInterpreterShadowSkipReason;
}): MeaningInterpreterShadowScheduleArgs {
  return {
    deterministicRoute: args.deterministicRoute,
    commitmentId: args.commitmentId ?? null,
    deterministicFacts: args.deterministicFacts,
    skipReason: args.skipReason,
  };
}

export type MeaningInterpreterShadowRunArgs = MeaningInterpreterShadowScheduleArgs & {
  clerkUserId: string;
  inboundMessageSid: string;
  coachJobMessageSid?: string | null;
  rawBody: string;
  replyBody?: string | null;
};

const SYSTEM_PROMPT = `You are Summitt Mindset's silent inbound SMS MEANING INTERPRETER (shadow mode).
Return ONLY one JSON object matching the schema. No user-facing SMS. No SQL. No state mutations.
Do not say "mark complete", "update commitment", or invent proof. Safety hints are non-authoritative hints only.
Be conservative on completion_or_proof — require explicit evidence in the user's message.
If unsure, use primary_intent "unclear" and lower confidence.`;

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function truncateInbound(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, INBOUND_TEXT_MAX);
}

function truncateReplyPreview(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  return text.trim().replace(/\s+/g, " ").slice(0, REPLY_PREVIEW_MAX);
}

function isComplianceTurn(raw: string): boolean {
  const low = raw.trim().toLowerCase();
  return /^(stop|start|help|unstop|cancel|unsubscribe)$/i.test(low);
}

function isAmbiguousClassifierHint(hint: string | null | undefined): boolean {
  if (!hint) return true;
  const h = hint.toLowerCase();
  return h === "blank" || h.includes("partial") || h.includes("unclear") || h.includes("ambiguous");
}

const PENDING_ROUTES = new Set([
  "pending_resolution_commitment_replace",
  "pending_resolution_commitment_tighten",
  "pending_resolution_rejected",
  "season_goal_change_confirmation",
]);

const CONTRACT_ROUTES = new Set(["contract_consent", "contract_ambiguous_consent"]);

const SHADOW_SKIP_REASONS_FROM_FACTS = new Set<MeaningInterpreterShadowSkipReason>([
  "compliance_turn",
  "safety_turn",
  "tapback_suppressed",
  "suppressed_no_send",
  "send_failed",
]);

/** Resolve finalize skipReason from explicit input or deterministic_facts.skip_reason. */
export function resolveMeaningInterpreterShadowSkipReason(args: {
  skipReason?: MeaningInterpreterShadowSkipReason;
  deterministicFacts?: MeaningInterpreterDeterministicFacts;
}): MeaningInterpreterShadowSkipReason | undefined {
  if (args.skipReason) return args.skipReason;
  const fromFacts = args.deterministicFacts?.skip_reason?.trim();
  if (!fromFacts) return undefined;
  if (SHADOW_SKIP_REASONS_FROM_FACTS.has(fromFacts as MeaningInterpreterShadowSkipReason)) {
    return fromFacts as MeaningInterpreterShadowSkipReason;
  }
  return undefined;
}

function openAiErrorStatus(err: unknown): number | null {
  if (err != null && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return null;
}

/** Map OpenAI SDK errors to granular shadow error_code values (no secrets). */
export function classifyMeaningInterpreterOpenAIError(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "openai_timeout";
  const status = openAiErrorStatus(err);
  if (status === 401 || status === 403) return "openai_auth_error";
  if (status === 429) return "openai_rate_limit";
  if (status === 404) return "openai_model_error";
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("incorrect api key") || msg.includes("invalid api key") || msg.includes("authentication")) {
    return "openai_auth_error";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) return "openai_rate_limit";
  if (
    msg.includes("model") &&
    (msg.includes("not found") || msg.includes("does not exist") || msg.includes("not available"))
  ) {
    return "openai_model_error";
  }
  return "openai_api_error";
}

function sanitizedOpenAIApiFailureDetail(err: unknown): Record<string, unknown> {
  const status = openAiErrorStatus(err);
  const detail: Record<string, unknown> = { stage: "openai_api" };
  if (status != null) detail.http_status = status;
  if (err instanceof Error && err.name && err.name !== "Error") {
    detail.error_name = err.name.slice(0, 64);
  }
  return detail;
}

export function isEligibleForMeaningInterpreterShadow(args: {
  rawBody: string;
  skipReason?: MeaningInterpreterShadowSkipReason;
  deterministicFacts?: MeaningInterpreterDeterministicFacts;
}): boolean {
  const effectiveSkip = resolveMeaningInterpreterShadowSkipReason(args);
  if (effectiveSkip === "compliance_turn" || effectiveSkip === "safety_turn") return false;
  if (effectiveSkip === "tapback_suppressed") return false;
  if (effectiveSkip === "suppressed_no_send") return false;
  if (effectiveSkip === "send_failed") return false;
  if (!args.rawBody.trim()) return false;
  if (isComplianceTurn(args.rawBody)) return false;
  return true;
}

export function shouldRunMeaningInterpreterShadow(args: {
  inboundMessageSid: string;
  rawBody: string;
  skipReason?: MeaningInterpreterShadowSkipReason;
  deterministicFacts?: MeaningInterpreterDeterministicFacts;
}): boolean {
  if (!isSmsMeaningInterpreterShadowEnabled()) return false;
  if (
    !isEligibleForMeaningInterpreterShadow({
      rawBody: args.rawBody,
      skipReason: args.skipReason,
      deterministicFacts: args.deterministicFacts,
    })
  ) {
    return false;
  }
  const rate = getSmsMeaningInterpreterSampleRate();
  if (!shouldSampleMeaningInterpreter(args.inboundMessageSid, rate)) return false;
  if (isSmsMeaningInterpreterAmbiguousOnly()) {
    const hint = args.deterministicFacts?.classifier_normalized_hint;
    const eventType = args.deterministicFacts?.classifier_event_type;
    if (
      eventType === "user_yes" ||
      eventType === "user_no" ||
      (!isAmbiguousClassifierHint(hint) && eventType !== "user_partial")
    ) {
      return false;
    }
  }
  return true;
}

export function computeMeaningInterpreterDisagreement(args: {
  deterministicRoute: string;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  shadow: MeaningInterpreterShadowParsed;
  outcomeSent?: boolean;
  jobStatus?: string | null;
}): { disagreement: boolean; flags: string[] } {
  const flags: string[] = [];
  const route = args.deterministicRoute;
  const intent = args.shadow.primary_intent;
  const facts = args.deterministicFacts;
  const confidence = args.shadow.confidence;
  const secondary = new Set(args.shadow.secondary_intents ?? []);
  const answeredPrior =
    args.shadow.answered_prior_open_question === "yes" ||
    secondary.has("answered_prior_open_question") ||
    secondary.has("time_answer_to_prior_question") ||
    secondary.has("short_numeric_time_answer") ||
    secondary.has("direct_answer_to_coach_question");
  const cancelledOrNoSend =
    args.outcomeSent === false ||
    args.jobStatus === "cancelled" ||
    facts.outcome_sent === false;

  if (intent === "commitment_change" && route === "normal_accountability") {
    flags.push("shadow_commitment_change_vs_normal_accountability");
  }
  if (intent === "pause_or_cadence" && route === "normal_accountability") {
    flags.push("shadow_pause_cadence_vs_normal_accountability");
  }
  if (
    intent === "open_question_answer" &&
    route !== "open_question_answer" &&
    facts.open_question_text
  ) {
    flags.push("shadow_open_question_answer_vs_route");
  }
  if (answeredPrior && cancelledOrNoSend && facts.open_question_text) {
    flags.push("shadow_answered_prior_question_but_cancelled");
  }
  if (
    (secondary.has("time_answer_to_prior_question") ||
      secondary.has("short_numeric_time_answer") ||
      args.shadow.answer_type === "time_or_schedule") &&
    (facts.open_question_routing_miss === true || route !== "open_question_answer")
  ) {
    flags.push("shadow_time_answer_vs_open_question_routing_miss");
  }
  if (
    (secondary.has("contract_yes_answer") || args.shadow.answer_type === "contract_yes_no") &&
    (facts.contract_consent_gate_miss === true || facts.gate_reason)
  ) {
    flags.push("shadow_contract_yes_vs_gate_miss");
  }
  if (
    secondary.has("cancellation_request") &&
    cancelledOrNoSend &&
    route !== "soft_opt_out_reply" &&
    route !== "relationship_exit_integrity"
  ) {
    flags.push("shadow_cancel_request_vs_no_support_route");
  }
  if (
    secondary.has("support_request") &&
    cancelledOrNoSend &&
    route !== "soft_opt_out_reply" &&
    route !== "relationship_exit_integrity"
  ) {
    flags.push("shadow_support_request_vs_no_support_route");
  }
  if (
    intent === "proof_or_completion" &&
    (facts.classifier_event_type === "user_no" || facts.classifier_event_type === "user_partial")
  ) {
    flags.push("shadow_proof_vs_classifier_no_partial");
  }
  if (intent === "compliance" && !route.includes("compliance") && route !== "compliance_skipped") {
    flags.push("shadow_compliance_vs_non_compliance_route");
  }
  if (PENDING_ROUTES.has(route) && intent === "meta_or_confusion" && confidence >= 0.65) {
    flags.push("shadow_meta_confusion_vs_pending_resolution");
  }
  if (
    CONTRACT_ROUTES.has(route) &&
    (intent === "meta_or_confusion" || intent === "unclear") &&
    confidence >= 0.65
  ) {
    flags.push("shadow_meta_confusion_vs_contract_consent");
  }
  if (intent === "blocker" && route === "normal_accountability") {
    flags.push("shadow_blocker_vs_normal_accountability");
  }
  if (args.shadow.disagrees_with_deterministic_route) {
    flags.push("model_disagrees_with_route");
  }

  return {
    disagreement: flags.length > 0,
    flags,
  };
}

function buildUserPrompt(args: MeaningInterpreterShadowRunArgs, patternHints?: string[]): string {
  const facts = args.deterministicFacts;
  const lines: string[] = [
    "Interpret the user's inbound SMS meaning for shadow telemetry only.",
    "",
    "OUTPUT JSON schema keys (version 2 preferred):",
    '{"version":2,"primary_intent":"...","secondary_intents":[],"answer_type":null,"answered_prior_open_question":null,"emotional_tone":"...","answered_open_question":"...","open_question_answer_summary":null,"signals":{"goal_change":false,"pause_or_cadence":false,"completion_or_proof":false,"blocker":false,"resistance_or_shame":false,"substitution_counts":false},"safety_hint":"none","confidence":0.0,"disagrees_with_deterministic_route":false,"disagreement_reason":null,"explanation_short":"...","recommended_followup_kind":"none"}',
    "",
    "secondary_intents may include shadow-only labels such as: answered_prior_open_question, time_answer_to_prior_question, short_numeric_time_answer, direct_answer_to_coach_question, contract_yes_answer, contract_no_answer, acknowledgement, cancellation_request, support_request, completion, miss, partial, blocker, goal_adjustment_request, unclear.",
    "",
    `deterministic_route: ${args.deterministicRoute}`,
  ];

  const factEntries: [string, string | boolean | null | undefined][] = [
    ["job_status", facts.job_status],
    ["last_error_tag", facts.last_error_tag],
    ["outcome_sent", facts.outcome_sent],
    ["route_purpose", facts.route_purpose],
    ["branch_name", facts.branch_name],
    ["classifier_event_type", facts.classifier_event_type],
    ["classifier_normalized_hint", facts.classifier_normalized_hint],
    ["gated_mode", facts.gated_mode],
    ["gated_outcome", facts.gated_outcome],
    ["open_question_text", facts.open_question_text ?? facts.latest_coach_question],
    ["expected_reply_semantics", facts.expected_reply_semantics],
    ["open_question_pending", facts.open_question_pending],
    ["open_question_answer_text", facts.open_question_answer_text],
    ["open_question_routing_miss", facts.open_question_routing_miss],
    ["pending_resolution_kind", facts.pending_resolution_kind],
    ["pending_applied", facts.pending_applied],
    ["overlay_action", facts.overlay_action],
    ["overlay_consent_pending", facts.overlay_consent_pending],
    ["adaptive_proposal_pending", facts.adaptive_proposal_pending],
    ["rpc_result", facts.rpc_result],
    ["refresh_step", facts.refresh_step],
    ["memory_pending_kind", facts.memory_pending_kind],
    ["comms_preference_action", facts.comms_preference_action],
    ["gate_reason", facts.gate_reason],
    ["v3_no_send_reason", facts.v3_no_send_reason],
    ["v3_lane_stage", facts.v3_lane_stage],
    ["contract_consent_gate_miss", facts.contract_consent_gate_miss],
    ["last_outbound_preview", facts.last_outbound_preview?.slice(0, OUTBOUND_PREVIEW_MAX)],
    ["last_outbound_full_body_preview", facts.last_outbound_full_body_preview?.slice(0, OUTBOUND_PREVIEW_MAX)],
    ["recent_transcript_preview", facts.recent_transcript_preview?.slice(0, OUTBOUND_PREVIEW_MAX)],
    ["behavior_statement", facts.behavior_statement?.slice(0, BEHAVIOR_MAX)],
    ["effective_ask_preview", facts.effective_ask_preview?.slice(0, BEHAVIOR_MAX)],
  ];

  for (const [key, value] of factEntries) {
    if (value != null && value !== "") {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  if (patternHints && patternHints.length > 0) {
    lines.push("");
    lines.push("Approved non-authoritative pattern hints (shadow review only):");
    for (const hint of patternHints.slice(0, 8)) {
      lines.push(`- ${hint}`);
    }
  }

  lines.push("");
  lines.push(`USER_INBOUND: ${truncateInbound(args.rawBody)}`);
  return lines.join("\n");
}

async function lookupSmsInboundMessageId(messageSid: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("id")
    .eq("message_sid", messageSid)
    .maybeSingle();
  if (error || !data?.id) return null;
  return typeof data.id === "string" ? data.id : String(data.id);
}

export type MeaningInterpreterOpenAIResult =
  | { ok: true; parsed: MeaningInterpreterShadowParsed; model: string; latencyMs: number }
  | {
      ok: false;
      errorCode: string;
      model: string | null;
      latencyMs: number;
      failureDetail?: Record<string, unknown>;
    };

export async function callMeaningInterpreterOpenAI(
  args: MeaningInterpreterShadowRunArgs
): Promise<MeaningInterpreterOpenAIResult> {
  const started = Date.now();
  const model = getSmsMeaningInterpreterModel();
  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, errorCode: "no_openai_key", model: null, latencyMs: Date.now() - started };
  }

  let patternHints: string[] = [];
  try {
    const hints = await listApprovedSmsPatternCorrectionsForShadowPrompt({
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId ?? undefined,
      limit: 8,
    });
    if (hints.ok) {
      patternHints = hints.rows.map(
        (row) =>
          `${row.meaning_label}: ${row.correction_summary}`.slice(0, 220)
      );
    }
  } catch {
    /* shadow-only hints must never block pipeline */
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(args, patternHints) },
        ],
        temperature: 0.25,
        max_tokens: 500,
      },
      { signal: controller.signal }
    );

    const rawStr = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!rawStr) {
      return {
        ok: false,
        errorCode: "openai_response_empty",
        model,
        latencyMs: Date.now() - started,
        failureDetail: { stage: "openai_response", reason: "empty_content" },
      };
    }

    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(rawStr) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        errorCode: "openai_json_parse_failed",
        model,
        latencyMs: Date.now() - started,
        failureDetail: { stage: "json_parse" },
      };
    }

    const parsed = parseAndValidateMeaningInterpreterShadow(parsedJson);
    if (!parsed) {
      const validationDetail: MeaningInterpreterShadowValidationFailureDetail =
        describeMeaningInterpreterShadowValidationFailure(parsedJson);
      return {
        ok: false,
        errorCode: "schema_validation_failed",
        model,
        latencyMs: Date.now() - started,
        failureDetail: validationDetail as unknown as Record<string, unknown>,
      };
    }

    return { ok: true, parsed, model, latencyMs: Date.now() - started };
  } catch (err) {
    const errorCode = classifyMeaningInterpreterOpenAIError(err);
    return {
      ok: false,
      errorCode,
      model,
      latencyMs: Date.now() - started,
      failureDetail: sanitizedOpenAIApiFailureDetail(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

type ShadowRowInsertArgs = {
  run: MeaningInterpreterShadowRunArgs;
  shadowStatus: MeaningInterpreterShadowStatus;
  openAi?: MeaningInterpreterOpenAIResult | null;
  skippedReason?: string | null;
  outcomeSent?: boolean;
};

async function insertMeaningInterpreterShadowRowInternal(
  args: ShadowRowInsertArgs
): Promise<{ ok: boolean; error?: string }> {
  const promptVersion = getSmsMeaningInterpreterPromptVersion();
  const normalized = args.run.rawBody.trim();
  const bodyHash = normalized ? hashSmsSnippet(normalized) : null;
  const bodyPreview = normalized
    ? (args.run.deterministicFacts.inbound_preview ??
        normalized.replace(/\s+/g, " ").slice(0, 120))
    : null;
  const replyBodyPreview =
    args.run.replyBody?.trim()
      ? truncateReplyPreview(args.run.replyBody)
      : shouldLogMeaningInterpreterBodyPreview() && args.run.replyBody
        ? truncateReplyPreview(args.run.replyBody)
        : null;

  let shadowJson: Record<string, unknown> | null = null;
  let primaryIntent: string | null = null;
  let confidence: number | null = null;
  let disagreement = false;
  let disagreementFlags: string[] | null = null;
  let ok = false;
  let errorCode: string | null = null;
  let model: string | null = null;
  let latencyMs: number | null = null;

  if (args.shadowStatus === "skipped") {
    ok = false;
    errorCode = "skipped_no_openai";
  } else if (args.openAi) {
    ok = args.openAi.ok;
    model = args.openAi.model;
    latencyMs = args.openAi.latencyMs;
    errorCode = args.openAi.ok ? null : args.openAi.errorCode;
    if (args.openAi.ok) {
      shadowJson = args.openAi.parsed as unknown as Record<string, unknown>;
      primaryIntent = args.openAi.parsed.primary_intent;
      confidence = args.openAi.parsed.confidence;
      const cmp = computeMeaningInterpreterDisagreement({
        deterministicRoute: args.run.deterministicRoute,
        deterministicFacts: args.run.deterministicFacts,
        shadow: args.openAi.parsed,
        outcomeSent: args.outcomeSent,
        jobStatus: args.run.deterministicFacts.job_status,
      });
      disagreement = cmp.disagreement;
      disagreementFlags = cmp.flags.length > 0 ? cmp.flags : null;
    }
  }

  const smsInboundMessageId = await lookupSmsInboundMessageId(args.run.inboundMessageSid);

  let deterministicFacts = args.run.deterministicFacts;
  if (args.openAi && !args.openAi.ok && args.openAi.failureDetail) {
    deterministicFacts = mergeMeaningInterpreterDeterministicFacts(deterministicFacts, {
      shadow_failure_detail: args.openAi.failureDetail,
    });
  }

  const row = {
    clerk_user_id: args.run.clerkUserId,
    commitment_id: args.run.commitmentId ?? null,
    sms_inbound_message_id: smsInboundMessageId,
    inbound_message_sid: args.run.inboundMessageSid,
    coach_job_message_sid: args.run.coachJobMessageSid ?? args.run.inboundMessageSid,
    deterministic_route: args.run.deterministicRoute,
    deterministic_facts: deterministicFacts,
    model,
    prompt_version: promptVersion,
    shadow_json: shadowJson,
    primary_intent: primaryIntent,
    confidence,
    disagreement,
    disagreement_flags: disagreementFlags,
    latency_ms: latencyMs,
    ok,
    error_code: errorCode,
    shadow_status: args.shadowStatus,
    skipped_reason: args.skippedReason ?? null,
    outcome_sent: args.outcomeSent ?? true,
    body_preview: bodyPreview,
    reply_body_preview: replyBodyPreview,
    body_hash: bodyHash,
  };

  const { error } = await supabaseServer.from("v2_sms_meaning_interpretation_shadow").insert(row);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return { ok: true };
    }
    console.warn("[meaning-interpreter-shadow] db_insert_failed", {
      message_sid: args.run.inboundMessageSid,
      error_code: "db_insert_failed",
      db_code: code ?? null,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function insertMeaningInterpreterShadowRow(args: {
  run: MeaningInterpreterShadowRunArgs;
  openAi: MeaningInterpreterOpenAIResult;
}): Promise<{ ok: boolean; error?: string }> {
  return insertMeaningInterpreterShadowRowInternal({
    run: args.run,
    openAi: args.openAi,
    shadowStatus: args.openAi.ok ? "openai_ok" : "openai_failed",
    outcomeSent: true,
  });
}

export type MeaningInterpreterSkippedShadowArgs = {
  clerkUserId: string;
  inboundMessageSid: string;
  coachJobMessageSid?: string | null;
  commitmentId?: string | null;
  deterministicRoute: string;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  skippedReason: string;
  outcomeSent: boolean;
  rawBody?: string;
};

export async function recordMeaningInterpreterSkippedShadow(
  args: MeaningInterpreterSkippedShadowArgs
): Promise<void> {
  await finalizeMeaningInterpreterShadowForInboundJob(
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: args.clerkUserId,
      inboundMessageSid: args.inboundMessageSid,
      coachJobMessageSid: args.coachJobMessageSid,
      commitmentId: args.commitmentId,
      rawBody: args.rawBody ?? "",
      outcomeSent: args.outcomeSent,
      jobStatus: args.deterministicFacts.job_final_status ?? "cancelled",
      deterministicRoute: args.deterministicRoute,
      deterministicFacts: mergeMeaningInterpreterDeterministicFacts(args.deterministicFacts, {
        skip_reason: args.skippedReason,
      }),
      skipReason: args.skippedReason as MeaningInterpreterShadowSkipReason | undefined,
    })
  );
}

function resolveMeaningInterpreterShadowSkippedReason(args: {
  input: MeaningInterpreterShadowFinalizeInput;
  run: MeaningInterpreterShadowRunArgs;
}): string {
  const effectiveSkip = resolveMeaningInterpreterShadowSkipReason({
    skipReason: args.run.skipReason,
    deterministicFacts: args.run.deterministicFacts,
  });
  if (
    !isEligibleForMeaningInterpreterShadow({
      rawBody: args.run.rawBody,
      skipReason: effectiveSkip,
      deterministicFacts: args.run.deterministicFacts,
    })
  ) {
    if (effectiveSkip) return effectiveSkip;
    if (args.run.skipReason) return args.run.skipReason;
    const factsSkip = args.run.deterministicFacts.skip_reason?.trim();
    if (factsSkip) return factsSkip;
    if (!args.run.rawBody.trim()) return "empty_message";
    if (isComplianceTurn(args.run.rawBody)) return "compliance_turn";
    return "ineligible";
  }
  if (
    !shouldSampleMeaningInterpreter(
      args.run.inboundMessageSid,
      getSmsMeaningInterpreterSampleRate()
    )
  ) {
    return "sampled_out";
  }
  if (isSmsMeaningInterpreterAmbiguousOnly()) {
    return "ambiguous_only_skip";
  }
  return args.input.skipReason ?? "openai_not_run";
}

/**
 * Terminal inbound observability: always writes deterministic facts when shadow is enabled;
 * OpenAI runs only when sampled/eligible.
 */
export async function finalizeMeaningInterpreterShadowForInboundJob(
  input: MeaningInterpreterShadowFinalizeInput
): Promise<void> {
  if (!isSmsMeaningInterpreterShadowEnabled()) return;

  const effectiveSkipReason = resolveMeaningInterpreterShadowSkipReason({
    skipReason: input.skipReason,
    deterministicFacts: input.deterministicFacts,
  });

  const run: MeaningInterpreterShadowRunArgs = {
    clerkUserId: input.clerkUserId,
    inboundMessageSid: input.inboundMessageSid,
    coachJobMessageSid: input.coachJobMessageSid ?? input.inboundMessageSid,
    commitmentId: input.commitmentId ?? null,
    rawBody: input.rawBody,
    replyBody: input.replyBody ?? null,
    deterministicRoute: input.deterministicRoute,
    skipReason: effectiveSkipReason,
    deterministicFacts: mergeMeaningInterpreterDeterministicFacts(input.deterministicFacts, {
      job_status: input.jobStatus ?? input.deterministicFacts.job_status ?? null,
      last_error_tag:
        input.deterministicFacts.last_error_tag ??
        parseMeaningInterpreterLastErrorTag(input.lastError),
      inbound_preview:
        input.deterministicFacts.inbound_preview ??
        (input.rawBody.trim() ? input.rawBody.trim().replace(/\s+/g, " ").slice(0, 120) : null),
      outcome_sent: input.outcomeSent,
    }),
  };

  const shouldOpenAi = shouldRunMeaningInterpreterShadow({
    inboundMessageSid: input.inboundMessageSid,
    rawBody: input.rawBody,
    skipReason: effectiveSkipReason,
    deterministicFacts: run.deterministicFacts,
  });

  if (shouldOpenAi) {
    const openAi = await callMeaningInterpreterOpenAI(run);
    const ins = await insertMeaningInterpreterShadowRowInternal({
      run,
      openAi,
      shadowStatus: openAi.ok ? "openai_ok" : "openai_failed",
      outcomeSent: input.outcomeSent,
    });
    if (!ins.ok) {
      console.warn("[meaning-interpreter-shadow] insert_failed", {
        message_sid: input.inboundMessageSid,
        error_code: "db_insert_failed",
        error: ins.error,
      });
      return;
    }
    if (openAi.ok) {
      console.log("[meaning-interpreter-shadow] stored", {
        message_sid: input.inboundMessageSid,
        shadow_status: "openai_ok",
        route: input.deterministicRoute,
        primary_intent: openAi.parsed.primary_intent,
        confidence: openAi.parsed.confidence,
        outcome_sent: input.outcomeSent,
      });
    } else {
      console.warn("[meaning-interpreter-shadow] openai_failed_stored", {
        message_sid: input.inboundMessageSid,
        shadow_status: "openai_failed",
        error_code: openAi.errorCode,
        model: openAi.model,
        latency_ms: openAi.latencyMs,
      });
    }
    return;
  }

  const skippedReason = resolveMeaningInterpreterShadowSkippedReason({ input, run });
  const ins = await insertMeaningInterpreterShadowRowInternal({
    run,
    shadowStatus: "skipped",
    skippedReason,
    outcomeSent: input.outcomeSent,
  });
  if (!ins.ok) {
    console.warn("[meaning-interpreter-shadow] skipped_insert_failed", {
      message_sid: input.inboundMessageSid,
      error_code: "db_insert_failed",
      skipped_reason: skippedReason,
      error: ins.error,
    });
  } else {
    console.log("[meaning-interpreter-shadow] skipped_stored", {
      message_sid: input.inboundMessageSid,
      shadow_status: "skipped",
      skipped_reason: skippedReason,
      route: input.deterministicRoute,
    });
  }
}

export function scheduleFinalizeMeaningInterpreterShadowForInboundJob(
  input: MeaningInterpreterShadowFinalizeInput
): void {
  void finalizeMeaningInterpreterShadowForInboundJob(input).catch((err) => {
    console.warn("[meaning-interpreter-shadow] finalize_failed", {
      message_sid: input.inboundMessageSid,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

export type { MeaningInterpreterShadowFinalizeInput } from "@/lib/sms-meaning-interpreter-context";
export {
  enrichMeaningInterpreterShadowPending,
  peekMeaningInterpreterShadowPending,
  registerMeaningInterpreterShadowPending,
  takeMeaningInterpreterShadowPending,
} from "@/lib/sms-meaning-interpreter-context";

/** Fire-and-forget skipped row (no OpenAI). */
export function scheduleMeaningInterpreterSkippedShadow(
  args: MeaningInterpreterSkippedShadowArgs
): void {
  void recordMeaningInterpreterSkippedShadow(args).catch((err) => {
    console.warn("[meaning-interpreter-shadow] skipped_pipeline_failed", {
      message_sid: args.inboundMessageSid,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Fire-and-forget entry: safe to call without await from SMS send path. */
export function scheduleInboundMeaningInterpreterShadow(args: MeaningInterpreterShadowRunArgs): void {
  scheduleFinalizeMeaningInterpreterShadowForInboundJob(
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: args.clerkUserId,
      inboundMessageSid: args.inboundMessageSid,
      coachJobMessageSid: args.coachJobMessageSid,
      commitmentId: args.commitmentId,
      rawBody: args.rawBody,
      replyBody: args.replyBody,
      outcomeSent: true,
      jobStatus: "sent",
      deterministicRoute: args.deterministicRoute,
      deterministicFacts: args.deterministicFacts,
      skipReason: args.skipReason,
    })
  );
}

export async function runMeaningInterpreterShadowPipeline(
  args: MeaningInterpreterShadowRunArgs
): Promise<void> {
  await finalizeMeaningInterpreterShadowForInboundJob(
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: args.clerkUserId,
      inboundMessageSid: args.inboundMessageSid,
      coachJobMessageSid: args.coachJobMessageSid,
      commitmentId: args.commitmentId,
      rawBody: args.rawBody,
      replyBody: args.replyBody,
      outcomeSent: true,
      jobStatus: "sent",
      deterministicRoute: args.deterministicRoute,
      deterministicFacts: args.deterministicFacts,
      skipReason: args.skipReason,
    })
  );
}

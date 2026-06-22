/**
 * Phase 4.2A — Weekly outbound V3 relationship lane.
 * OpenAI authors visible weekly SMS from structured facts; fail-closed, no deterministic coaching fallback.
 */

import OpenAI from "openai";

import { matchesMalformedDidRawPhraseHappenToday } from "@/lib/north-star-coach-sms";
import {
  applySmsMemoryAntiRepeatGuard,
  buildAntiRepeatDetectArgsFromWeeklyFacts,
  shouldRunWeeklyMemoryRepeatGuard,
} from "@/lib/sms-memory-anti-repeat";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import {
  evaluateRelationshipVoiceWithPraisePolicy,
  partitionFinalVoiceBlockedReasons,
  runLanePostValidateRepairLoop,
  type LanePostValidateRepairValidationResult,
  repairV3RelationshipLaneBodyWithOpenAI,
} from "@/lib/v3-sms-voice-ownership";
import { buildSmsPraisePolicyArgsFromWeeklyFacts } from "@/lib/sms-earned-praise-policy";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import { buildSmsGoalAdjustmentLaneGuardrails } from "@/lib/sms-goal-adjustment-signal";
import { buildPlannedInterruptionLaneGuardrails } from "@/lib/sms-planned-interruption";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipMemory30dResult } from "@/lib/sms-relationship-memory-30d";
import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  buildWriterUserPromptWithStrategyCard,
  relationshipPacketMetaForLaneTelemetry,
} from "@/lib/sms-relationship-packet-v1";
import {
  buildStrategyCardV1PromptGuidance,
  buildWeeklyProofStrategyCardV1,
  buildWeeklyStrategyCardContextFromSnapshot,
  isWeeklyProofStrategyCardEligible,
  strategyCardV1MetaForTelemetry,
  strategyCardV1UserPromptAppendix,
  validateAndRepairWeeklyProofStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { prepareRepairSnapshotForOpenAI } from "@/lib/sms-relationship-repair-snapshot-v1";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import {
  buildVictoryBackgroundLaneGuardrails,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";

/** Aligns with {@link detectFinalVoiceBlockedReasons} `too_long` guard for post-FVG compatibility. */
const WEEKLY_V3_LANE_MAX_CHARS = 320;

const WEEKLY_LANE_REPAIR_SYSTEM_INSTRUCTION = `This is a weekly reflection/proof SMS in an ongoing coaching relationship — NOT a daily check-in.
- Do not echo or paraphrase old_weekly_proof_body_preview, deterministic_weekly_body_preview, legacy_reflection_preview, or legacy_template_preview.
- Do not use Pat Pause openers, newsletter/report language, or generic motivation filler.
- Preserve the useful weekly meaning from the original candidate; compress style issues only.`;

export type WeeklyV3RoutePurpose =
  | "weekly_proof_v2"
  | "weekly_legacy_reflection"
  | "weekly_legacy_fallback_summary";

export type WeeklyV3ReplySource = "v3_weekly_relationship_lane";

export type WeeklyV3CommitmentFacts = {
  active_commitment_id: string | null;
  behavior_statement: string | null;
  effective_ask: string | null;
  commitment_state: string | null;
  identity_anchor?: string | null;
  planned_interruption_active?: boolean;
  planned_interruption_reason_category?: string | null;
  planned_interruption_resume_hint?: string | null;
  goal_adjustment_move?: string | null;
  goal_adjustment_confidence?: string | null;
  goal_adjustment_mention_allowed?: boolean;
  goal_adjustment_internal_hint?: string | null;
  goal_adjustment_requires_confirmation?: boolean;
  goal_adjustment_compatible_flow?: string | null;
};

export type WeeklyV3ThreadFacts = {
  /** Legacy conv previews — fallback only when exact thread missing. */
  latest_outbound_preview: string | null;
  latest_inbound_preview: string | null;
  recent_transcript_lines: string[];
  recent_exact_thread_text: string | null;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_pending: boolean;
  open_question_source: string | null;
  answer_source: string | null;
  projection_used: boolean;
  memory_packet_used: boolean;
  recent_exact_message_count: number | null;
  do_not_repeat_hints: string[];
  coaching_memory_snippet: string | null;
  memory_priority_rules: string[];
  recent_exact_thread_72h?: RecentExactThread72hResult | null;
  relationship_memory_7d?: RelationshipMemory7dResult | null;
  relationship_memory_30d?: RelationshipMemory30dResult | null;
  thread_freshness?: ThreadFreshnessFacts | null;
};

export type WeeklyV3ProofFacts = {
  week_start: string;
  week_end: string;
  completed_count: number;
  missed_count: number;
  /** Raw user_no rows before day dedupe (telemetry). */
  raw_missed_count?: number;
  distinct_missed_day_count?: number;
  false_or_suspect_missed_count?: number;
  unknown_day_missed_count?: number;
  exact_miss_day_count_reliable?: boolean;
  partial_count: number;
  blocker_count: number;
  proof_moment_hints: string[];
  win_hints: string[];
  comeback_hints: string[];
  repeated_blocker_hints: string[];
  notable_pattern: string | null;
  silent_week: boolean;
  rough_week: boolean;
  strong_week: boolean;
  /** True when an active planned interruption overlaps this week — not failure framing. */
  planned_pause_week?: boolean;
  /** Metadata-only previews; must not appear verbatim in final body. */
  old_weekly_proof_body_preview: string | null;
  deterministic_weekly_body_preview: string | null;
  legacy_reflection_preview: string | null;
  legacy_template_preview: string | null;
};

export type WeeklyV3OutboundFacts = {
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_date: string;
    local_time: string;
    sms_engagement_summary?: string | null;
  };
  commitment: WeeklyV3CommitmentFacts;
  thread: WeeklyV3ThreadFacts;
  weekly_proof: WeeklyV3ProofFacts;
  route: {
    route_purpose: WeeklyV3RoutePurpose;
    fully_on_v2: boolean;
    reason_for_send: "sunday_weekly_touchpoint";
    legacy_weekly_branch: boolean;
  };
  /** Read-only Victory Room background (season label + Pat Read); non-speakable unless naturally relevant. */
  victory_background?: V3VictoryBackgroundFacts | null;
  temporal_contract?: import("@/lib/sms-temporal-contract-v1").TemporalContractV1 | null;
  constraints?: {
    required_verbatim_substrings?: string[];
  };
};

export type WeeklyV3RelationshipLaneInput = {
  facts: WeeklyV3OutboundFacts;
  /** Labels for upstream fact modules (never treated as authored voice). */
  telemetry_fact_sources: string[];
  /** Authoritative server row for row-backed active_pending_state (read-only context). */
  commitmentRow?: import("@/lib/v2-commitment").ActiveV2CommitmentRow | null;
};

export type WeeklyV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: WeeklyV3ReplySource;
  routePurpose: WeeklyV3RoutePurpose;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
};

const PAT_PAUSE_TEMPLATE_MARKERS = [
  "time for a pat pause",
  "let's take a pat pause",
  "it's your weekly pat pause",
  "time for our sunday pat pause",
] as const;

const NEWSLETTERISH = [
  "weekly digest",
  "this week in review",
  "here's your report",
  "here is your report",
  "your weekly report",
] as const;

/** Internal product labels that must never appear in user-visible weekly SMS. */
export const WEEKLY_PLANNED_PAUSE_LEAK_PHRASES = [
  "planned pause week",
  "planned pause",
  "honor this planned pause",
  "honor the planned pause",
  "as we honor this planned pause",
  "this week was a planned pause",
  "planned_pause_week",
] as const;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  route_purpose?: unknown;
  voice_confidence?: unknown;
  used_facts?: unknown;
  safety_notes?: unknown;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function safeJsonParse(raw: string): LaneModelJson | null {
  try {
    return JSON.parse(raw) as LaneModelJson;
  } catch {
    return null;
  }
}

function bodyPreview(s: string): string {
  return s.length > 220 ? `${s.slice(0, 219)}…` : s;
}

/** Weekly Pat Pause goal-adjustment guardrails (background only; no mutation). */
export function buildWeeklyGoalAdjustmentLaneGuardrails(): string {
  return `${buildSmsGoalAdjustmentLaneGuardrails()}
WEEKLY GOAL_ADJUSTMENT (Pat Pause):
- goal_adjustment_* is background guidance for next-week framing only — not permission to mutate.
- Weekly SMS must not say the goal changed unless server state already shows it changed.
- Do not create a YES/NO menu or binding overlay proposal in weekly SMS.
- If shrink_temporary, upstream, tighten_durable, or replace: gentle next-week consideration only — not action already taken.
- If raise_bar: invitation to discuss raising the bar — not a command to change the goal.
- If pause_cadence or planned_interruption_active: treat sparse replies as honest context — not failure framing; never say "planned pause" to the user.
- Mention goal adjustment only when goal_adjustment_mention_allowed is true; never quote goal_adjustment_internal_hint verbatim.
- If weekly_proof.proof_moment_hints are present, prioritize earned proof over goal-adjustment coaching.
- Current Goal / effective ask stays primary; do not mention goal adjustment every week.`;
}

/** Weekly Pat Pause guardrails when planned interruption is active in facts. */
export function buildWeeklyPlannedInterruptionLaneGuardrails(): string {
  return `${buildPlannedInterruptionLaneGuardrails()}
WEEKLY PAT PAUSE (when commitment.planned_interruption_active or weekly_proof.planned_pause_week — INTERNAL FLAGS ONLY):
- planned_pause_week and planned_interruption_* are internal telemetry — NEVER say "planned pause", "planned pause week", "honor this planned pause", or planned_pause_week to the user.
- Sparse or silent replies may reflect travel, illness, or a disrupted week — name that plainly in normal human language if helpful; do not narrate product state.
- Do not shame silence, missed days, or sparse replies during the interruption window.
- Do not use blocker-capture style language for a quiet week.
- Prefer calm resume framing, one next-week standard, or a smaller version when helpful (use planned_interruption_resume_hint when present).
- No YES/NO / PARTIAL menus. Current Goal / effective ask remains primary.
- Do not claim cadence or commitment already changed unless facts show it.
- Keep the relationship alive without a performance-report tone.`;
}

function summarizeWeeklyFacts(f: WeeklyV3OutboundFacts): string {
  const slim = {
    route_purpose: f.route.route_purpose,
    fully_on_v2: f.route.fully_on_v2,
    legacy_weekly_branch: f.route.legacy_weekly_branch,
    week: [f.weekly_proof.week_start, f.weekly_proof.week_end],
    counts: {
      completed: f.weekly_proof.completed_count,
      missed: f.weekly_proof.missed_count,
      partial: f.weekly_proof.partial_count,
      blockers: f.weekly_proof.blocker_count,
    },
    flags: {
      silent_week: f.weekly_proof.silent_week,
      rough_week: f.weekly_proof.rough_week,
      strong_week: f.weekly_proof.strong_week,
    },
    has_commitment: Boolean(f.commitment.active_commitment_id),
    memory_packet_used: f.thread.memory_packet_used,
    projection_used: f.thread.projection_used,
    preview_lengths: {
      old_proof: f.weekly_proof.old_weekly_proof_body_preview?.length ?? 0,
      deterministic: f.weekly_proof.deterministic_weekly_body_preview?.length ?? 0,
      legacy_reflection: f.weekly_proof.legacy_reflection_preview?.length ?? 0,
      legacy_template: f.weekly_proof.legacy_template_preview?.length ?? 0,
    },
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

export function weeklyLaneLocalValidation(body: string, facts: WeeklyV3OutboundFacts): string[] {
  const hits: string[] = [];
  const t = body.trim();
  const lower = t.toLowerCase();

  if (/\bV2\b/i.test(t)) hits.push("internal_v2_token");
  if (/\bevent_type\b/i.test(t)) hits.push("internal_event_type_token");
  if (/\bblocker_captured\b/i.test(t)) hits.push("internal_blocker_captured_token");
  if (/\buser_partial\b/i.test(t)) hits.push("internal_user_partial_token");

  for (const ph of NEWSLETTERISH) {
    if (lower.includes(ph)) hits.push(`newsletterish:${ph}`);
  }

  for (const m of PAT_PAUSE_TEMPLATE_MARKERS) {
    if (lower.includes(m)) hits.push("pat_pause_template_marker");
  }

  for (const ph of WEEKLY_PLANNED_PAUSE_LEAK_PHRASES) {
    if (lower.includes(ph)) hits.push(`internal_planned_pause_label:${ph}`);
  }

  if (matchesMalformedDidRawPhraseHappenToday(t)) hits.push("daily_check_malformed_phrase");

  const previews: Array<[string, string | null]> = [
    ["old_proof_preview", facts.weekly_proof.old_weekly_proof_body_preview],
    ["deterministic_preview", facts.weekly_proof.deterministic_weekly_body_preview],
    ["legacy_reflection_preview", facts.weekly_proof.legacy_reflection_preview],
    ["legacy_template_preview", facts.weekly_proof.legacy_template_preview],
  ];
  for (const [label, pv] of previews) {
    const p = typeof pv === "string" ? pv.trim() : "";
    if (p.length < 12) continue;
    const chunk = p.slice(0, 48).trim();
    if (chunk.length < 8) continue;
    if (lower.includes(chunk.toLowerCase())) hits.push(`echoes_${label}`);
  }

  return hits;
}

function weeklyValidateAfterPostRepair(
  body: string,
  facts: WeeklyV3OutboundFacts
): LanePostValidateRepairValidationResult {
  const afterRepair = weeklyPostValidateHits(body, facts);
  if (afterRepair.blockedReasons.length === 0) {
    return { blockedReasons: [] };
  }
  const hardReasons = [...afterRepair.localHits, ...afterRepair.hard];
  return {
    blockedReasons: afterRepair.blockedReasons,
    hardReasons: hardReasons.length > 0 ? hardReasons : undefined,
    failedReason: hardReasons.length > 0 ? "hard_after_first_repair" : undefined,
  };
}

function weeklyPostValidateHits(body: string, facts: WeeklyV3OutboundFacts): {
  localHits: string[];
  fvgHits: string[];
  blockedReasons: string[];
  repairable: string[];
  hard: string[];
  praiseMetadata: Record<string, unknown>;
} {
  const localHits = weeklyLaneLocalValidation(body, facts);
  const praisePolicy = buildSmsPraisePolicyArgsFromWeeklyFacts({
    body,
    routePurpose: facts.route.route_purpose,
    commitment: facts.commitment,
    weekly_proof: facts.weekly_proof,
    thread: {
      recent_exact_thread_72h: facts.thread.recent_exact_thread_72h,
      relationship_memory_7d: facts.thread.relationship_memory_7d,
      last_5_coach_questions: facts.thread.last_5_coach_questions,
    },
  });
  const voice = evaluateRelationshipVoiceWithPraisePolicy(body, { praisePolicy });
  const fvgHits = voice.reasons;
  const { repairable, hard: hardFvg } = partitionFinalVoiceBlockedReasons(fvgHits);
  const hard = [...localHits, ...hardFvg];
  const blockedReasons = [...new Set([...localHits, ...fvgHits])];
  return {
    localHits,
    fvgHits,
    blockedReasons,
    repairable,
    hard,
    praiseMetadata: voice.praiseMetadata,
  };
}

/**
 * Produces weekly relationship SMS from structured facts only.
 * Fail-closed: no OpenAI / parse / validation success → shouldSend false, empty body.
 */
export async function produceWeeklyV3RelationshipSms(
  args: WeeklyV3RelationshipLaneInput
): Promise<WeeklyV3RelationshipLaneResult> {
  const f = args.facts;
  const routePurpose = f.route.route_purpose;

  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    weekly_v3_lane_used: true,
    secondary_v3_lane_used: true,
    route_purpose: routePurpose,
    v3_lane_reply_source: "v3_weekly_relationship_lane" satisfies WeeklyV3ReplySource,
    old_weekly_writer_used_as_voice: false,
    old_weekly_writer_fact_sources: args.telemetry_fact_sources,
    weekly_facts_summary: summarizeWeeklyFacts(f),
    fully_on_v2: f.route.fully_on_v2,
    legacy_weekly_branch: f.route.legacy_weekly_branch,
    weekly_memory_packet_used: f.thread.memory_packet_used,
    weekly_projection_used: f.thread.projection_used,
    weekly_memory_open_question_source: f.thread.open_question_source,
    weekly_memory_answer_source: f.thread.answer_source,
    weekly_memory_recent_thread_count: f.thread.recent_exact_message_count,
  };

  const empty = (
    reason: string,
    openAiOk: boolean,
    extra?: Record<string, unknown>
  ): WeeklyV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_weekly_relationship_lane",
    routePurpose,
    voiceConfidence: null,
    usedFacts: [],
    safetyNotes: [],
    metadata: {
      ...baseMeta,
      v3_candidate_body: "",
      should_send: false,
      no_send_reason: reason,
      openai_ok: openAiOk,
      used_facts: [],
      safety_notes: [],
      ...extra,
    },
    openAiOk,
  });

  const client = getOpenAIClient();
  if (!client) {
    return empty("openai_unavailable", false, { lane_stage: "no_client" });
  }

  const relationshipPacket = buildRelationshipPacketForOpenAI({
    lane: "weekly",
    sourceFacts: f,
    commitmentRow: args.commitmentRow ?? null,
  });
  Object.assign(
    baseMeta,
    relationshipPacketMetaForLaneTelemetry(relationshipPacket.meta, relationshipPacket.snapshotV2Meta)
  );

  let strategyCardUserAppendix = "";
  let strategyCardPromptGuidance = "";
  const strategyCardWeeklyEligible = isWeeklyProofStrategyCardEligible(f);
  if (strategyCardWeeklyEligible) {
    const strategyCtx = buildWeeklyStrategyCardContextFromSnapshot({
      facts: f,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = buildWeeklyProofStrategyCardV1({ ctx: strategyCtx });
    const validated = validateAndRepairWeeklyProofStrategyCardV1(draftCard, strategyCtx);
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated, strategyCtx));
  }

  const system = `You write the NEXT SMS in one long coaching relationship (months of texts). This weekly touchpoint is NOT a newsletter or performance report.

RULES:
- Use RELATIONSHIP_PACKET_V1 only as facts — never copy labeled machine drafts, template banks, or telemetry previews as your voice.
- If current_turn.planned_pause_week is true (internal flag — never say "planned pause" or repeat this label to the user), sparse or silent replies are context, not failure; do not shame missed days or quiet weeks.
${strategyCardWeeklyEligible ? "" : `- If current_turn.silent_week or current_turn.rough_week is true, be honest and useful without shaming. If there is not enough context for a genuinely useful weekly coaching text, return should_send false.`}
${strategyCardWeeklyEligible ? "" : `- If structured_recent_truth.weekly_week_summary lists proof_moment_hints, win_hints, or comeback_hints, acknowledgment must be specific and earned — not generic hype.`}
- Do not repeat questions in structured_recent_truth.last_5_coach_questions unless the user clearly has not answered and you briefly acknowledge that.
- If structured_recent_truth.open_question_pending is false and structured_recent_truth.latest_answer_after_open_question is set, move forward from that answer — do not ask that open question again.
- Bring back meaningful user language from recent_exact_thread_72h naturally when useful; do not re-ask for information they already gave.
${strategyCardWeeklyEligible ? "" : `- Do not use "Welcome back" unless silent_week / reentry context in the packet truly supports it.`}
${strategyCardWeeklyEligible ? "" : `- At most one useful question in the body, or none if a question would feel forced.`}
- One short SMS, max ${WEEKLY_V3_LANE_MAX_CHARS} characters, single line or very short paragraphs; no markdown, bullets, or "Coach:" prefix.
- Do not use generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope you're having").
- Do not use Pat Pause-style openers or newsletter/report language.
- Never mention internal systems, schema, memory, projection, or "V2".
- Never emit raw machine tokens like event_type, blocker_captured, user_partial.
- Avoid daily-check phrasing like "Did [raw behavior text] happen today?" — this is weekly, not today's rep check.
${buildRelationshipPacketPromptGuidance()}
${strategyCardPromptGuidance}
${buildVictoryBackgroundLaneGuardrails()}
${buildWeeklyGoalAdjustmentLaneGuardrails()}
${f.commitment.planned_interruption_active || f.weekly_proof.planned_pause_week ? buildWeeklyPlannedInterruptionLaneGuardrails() : ""}

OUTPUT: strict JSON only with keys:
should_send (boolean),
body (string, empty if should_send false),
no_send_reason (string|null),
route_purpose (string, must equal "${routePurpose}"),
voice_confidence (number 0-1 or null),
used_facts (string[]),
safety_notes (string[])`;

  const writerUserPrompt = buildWriterUserPromptWithStrategyCard({
    userPromptJson: relationshipPacket.userPromptJson,
    strategyCardAppendix: strategyCardUserAppendix,
    stripWhenCardActive: strategyCardWeeklyEligible ? { lane: "weekly" } : undefined,
  });
  if (writerUserPrompt.stripped_fields.length > 0) {
    Object.assign(baseMeta, {
      strategy_card_packet_writer_hints_stripped: true,
      strategy_card_packet_stripped_fields: writerUserPrompt.stripped_fields,
    });
  }
  const user = writerUserPrompt.prompt;

  let laneOpenAiJsonMeta: Record<string, unknown> = {};
  let parsed: LaneModelJson | null = null;
  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<LaneModelJson>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 420,
      primaryMessages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      jsonSchemaReminder: `Keys: should_send (boolean), body (string), no_send_reason (string|null), route_purpose (string, must equal "${routePurpose}"), voice_confidence (number 0-1 or null), used_facts (string[]), safety_notes (string[]).`,
      parse: safeJsonParse,
    });
    parsed = jsonOut.value;
    laneOpenAiJsonMeta = jsonOut.retryMeta as unknown as Record<string, unknown>;
  } catch (e) {
    return empty("openai_request_failed", true, {
      lane_stage: "openai_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (!parsed) {
    return empty("invalid_json", true, {
      lane_stage: "parse",
      ...laneOpenAiJsonMeta,
    });
  }

  const modelRoute = typeof parsed.route_purpose === "string" ? parsed.route_purpose.trim() : "";
  if (modelRoute !== routePurpose) {
    return empty("route_purpose_mismatch", true, {
      lane_stage: "route_purpose",
      model_route_purpose: modelRoute || null,
      ...laneOpenAiJsonMeta,
    });
  }

  const shouldSendModel = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);
  let successLaneStage: "ok" | "post_validate_repaired" = "ok";
  let successRepairExtra: Record<string, unknown> = {};

  if (!shouldSendModel) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: noSendReason || "model_no_send",
      replySource: "v3_weekly_relationship_lane",
      routePurpose,
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "model_no_send",
        v3_candidate_body: "",
        should_send: false,
        no_send_reason: noSendReason || "model_no_send",
        openai_ok: true,
        used_facts: usedFacts,
        safety_notes: safetyNotes,
      },
      openAiOk: true,
    };
  }

  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body", ...laneOpenAiJsonMeta });
  }

  const initialValidate = weeklyPostValidateHits(body, f);
  if (initialValidate.blockedReasons.length > 0) {
    const { localHits, repairable, hard, blockedReasons } = initialValidate;

    if (localHits.length > 0 || hard.length > 0) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_weekly_relationship_lane",
        routePurpose,
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...blockedReasons.map((b) => `blocked:${b}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_blocked",
          v3_candidate_body: body,
          blocked_reasons: blockedReasons,
          repairable_blocked_reasons: repairable,
          hard_blocked_reasons: hard,
          should_send: false,
          no_send_reason: "lane_post_validate_blocked",
          openai_ok: true,
          used_facts: usedFacts,
          safety_notes: [...safetyNotes, ...blockedReasons],
        },
        openAiOk: true,
      };
    }

    const originalCandidateSnapshot = body;

    const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
      repairKind: "lane_post_validate",
      routeKind: "weekly",
      routePurpose,
      blockedBody: body,
      blockedReasons: repairable,
      laneFacts: f,
      laneBlockedReasons: blockedReasons,
    });

    const repairLoop = await runLanePostValidateRepairLoop({
      routeKind: "weekly",
      routePurpose,
      originalBody: body,
      initialBlocked: blockedReasons,
      initialRepairable: repairable,
      repairSnapshot,
      snapshotMeta,
      systemInstruction: WEEKLY_LANE_REPAIR_SYSTEM_INSTRUCTION,
      validateAfterRepair: (candidate) => weeklyValidateAfterPostRepair(candidate, f),
    });

    if (!repairLoop.ok) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_weekly_relationship_lane",
        routePurpose,
        voiceConfidence,
        usedFacts,
        safetyNotes: [
          ...safetyNotes,
          ...blockedReasons.map((b) => `blocked:${b}`),
          ...(repairLoop.repairedBlockedReasons ?? []).map((b) => `repaired_blocked:${b}`),
        ],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_repair_failed",
          v3_candidate_body: originalCandidateSnapshot,
          blocked_reasons: blockedReasons,
          repairable_blocked_reasons: repairable,
          hard_blocked_reasons: [],
          lane_repair_attempted: true,
          lane_repair_succeeded: false,
          original_blocked_reasons: repairable,
          original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
          repaired_candidate_body: repairLoop.repairedBody,
          repaired_blocked_reasons: repairLoop.repairedBlockedReasons,
          lane_repair_used_strategy: repairLoop.lastRepairMetadata.lane_repair_used_strategy,
          lane_repair_safety_notes: repairLoop.lastRepairMetadata.lane_repair_safety_notes,
          ...snapshotMeta,
          ...repairLoop.telemetry,
        },
        openAiOk: true,
      };
    }

    body = repairLoop.body;
    successLaneStage = "post_validate_repaired";
    successRepairExtra = {
      lane_repair_attempted: true,
      lane_repair_succeeded: true,
      original_blocked_reasons: repairable,
      repairable_blocked_reasons: repairable,
      hard_blocked_reasons: [],
      original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
      repaired_candidate_body: repairLoop.body,
      repaired_blocked_reasons: [],
      lane_repair_used_strategy: repairLoop.lastRepairMetadata.lane_repair_used_strategy,
      lane_repair_safety_notes: repairLoop.lastRepairMetadata.lane_repair_safety_notes,
      ...snapshotMeta,
      ...repairLoop.telemetry,
    };
  }

  const memoryRepeatGuard = await applySmsMemoryAntiRepeatGuard({
    routeKind: "weekly",
    routePurpose,
    body,
    factsJson: f,
    detectInput: buildAntiRepeatDetectArgsFromWeeklyFacts(f, body),
    enabled: shouldRunWeeklyMemoryRepeatGuard(f),
    validateAfterRepair: async (candidate) => {
      const afterRepair = weeklyPostValidateHits(candidate, f);
      if (afterRepair.blockedReasons.length > 0) {
        return {
          ok: false,
          noSendReason: "lane_post_validate_blocked",
          extraMeta: { repaired_blocked_reasons: afterRepair.blockedReasons },
        };
      }
      return { ok: true };
    },
    additionalRepairInstruction:
      "Keep weekly framing for the week. Move the relationship forward in one natural SMS. Do not mention internal memory or projection.",
    noSendReason: "weekly_thread_memory_repeat_blocked",
  });

  if (memoryRepeatGuard.outcome === "no_send") {
    return {
      body: "",
      shouldSend: false,
      noSendReason: memoryRepeatGuard.noSendReason,
      replySource: "v3_weekly_relationship_lane",
      routePurpose,
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "weekly_thread_memory_repeat_guard_failed",
        v3_candidate_body: body,
        ...memoryRepeatGuard.metadata,
      },
      openAiOk: true,
    };
  }

  body = memoryRepeatGuard.body;
  if (memoryRepeatGuard.metadata.memory_repeat_guard_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
  } else if (Object.keys(memoryRepeatGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
  }

  const finalWeeklyPraise = weeklyPostValidateHits(body, f);

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_weekly_relationship_lane",
    routePurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      ...laneOpenAiJsonMeta,
      lane_stage: successLaneStage,
      v3_candidate_body: body,
      should_send: true,
      no_send_reason: null,
      openai_ok: true,
      used_facts: usedFacts,
      safety_notes: safetyNotes,
      ...successRepairExtra,
      ...finalWeeklyPraise.praiseMetadata,
      praise_policy_context: buildSmsPraisePolicyArgsFromWeeklyFacts({
        body,
        routePurpose: f.route.route_purpose,
        commitment: f.commitment,
        weekly_proof: f.weekly_proof,
        thread: {
          recent_exact_thread_72h: f.thread.recent_exact_thread_72h,
          relationship_memory_7d: f.thread.relationship_memory_7d,
          last_5_coach_questions: f.thread.last_5_coach_questions,
        },
      }),
    },
    openAiOk: true,
  };
}

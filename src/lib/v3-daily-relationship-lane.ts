/**
 * Daily Central V3 Relationship Lane — Phase 2 (all daily user-facing branches).
 * OpenAI authors the visible daily SMS; V2/accountability inputs are facts only (no upstream prose as seed).
 */

import OpenAI from "openai";

import type { V2DailyMessagePurpose } from "@/lib/v2-ai-outbound";
import type { V2OutboundStrategy } from "@/lib/v2-ai-outbound";
import type { V2NextMoveKind } from "@/lib/v2-sms-accountability";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import {
  detectFinalVoiceBlockedReasons,
  partitionFinalVoiceBlockedReasons,
  repairV3RelationshipLaneBodyWithOpenAI,
} from "@/lib/v3-sms-voice-ownership";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";

const DAILY_LANE_MAX_CHARS = 300;

export type DailyV3RouteKind =
  | "main_active_accountability"
  | "low_pressure_reactivation"
  | "pending_resolution"
  | "refresh_identity"
  | "refresh_commitment"
  | "contract_prompt";

export type DailyV3ContractProposalFacts = {
  binding_text_verbatim: string;
  contract_kind: "shrink_ask" | "recommit_same";
  /** User must be able to accept or decline the binding terms meaningfully (YES/NO semantics). */
  required_reply_semantics: "yes_no_binding_only";
};

export type DailyV3PendingResolutionFacts = {
  resolution_kind: string | null;
  expires_at: string | null;
  payload_source: string | null;
  sms_state: string | null;
  detected_intent: string | null;
  candidate_behavior_snippet: string | null;
  awaiting_user_confirmation: boolean;
};

export type DailyV3RefreshFacts = {
  refresh_step: "identity_first" | "commitment_daily";
  identity_anchor_text?: string | null;
  effective_ask_for_bar?: string | null;
};

export type DailyV3RelationshipFacts = {
  route_kind: DailyV3RouteKind;
  accountability_day_key: string;
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_time_iso: string;
    /** Soft tone hints only; not authoritative facts. */
    relationship_profile_summary: string | null;
  };
  commitment: {
    id: string;
    title: string;
    behavior_statement: string;
    effective_ask: string;
    accountability_phase: string;
    identity_anchor_allowed: boolean;
    identity_anchor_short: string | null;
  };
  thread_memory: {
    latest_outbound_sms: string | null;
    latest_inbound_sms: string | null;
    recent_transcript_or_context_block: string | null;
    latest_open_question: string | null;
    do_not_repeat_hints: string[];
    coaching_memory_snippet: string;
    recent_pattern_hints: string | null;
  };
  accountability: {
    daily_purpose: V2DailyMessagePurpose;
    server_strategy: V2OutboundStrategy;
    next_move_type: V2NextMoveKind;
    prior_outcome: string | null;
    yes_streak_14d: number | null;
    no_count_14d: number | null;
    partial_count_14d: number | null;
    blocker_preview: string | null;
    proof_or_milestone_signal: string | null;
    silence_tier: string;
    unanswered_checks: number;
    days_since_last_user_outcome: number;
    reentry_active: boolean;
    overlay_active: boolean;
    evolution_pattern_hint: string | null;
    contract_proposal_mode: boolean;
  };
  /** When route is pending-resolution daily reminder. */
  pending_resolution?: DailyV3PendingResolutionFacts | null;
  /** When route is refresh identity or commitment step. */
  refresh?: DailyV3RefreshFacts | null;
  /** When route is contract / adaptive overlay proposal daily. */
  contract_proposal?: DailyV3ContractProposalFacts | null;
  suggested_coaching_move: string;
  constraints: {
    max_chars: number;
    one_sms: true;
    no_raw_title_or_behavior_paste: true;
    no_generic_motivation: true;
    if_unsafe_return_no_send: true;
    /** Each non-empty string MUST appear verbatim in `body` when should_send is true. */
    required_verbatim_substrings?: string[];
  };
};

/** Facts without derived `suggested_coaching_move` / `constraints` (used by {@link deriveSuggestedCoachingMoveForDailyFacts}). */
export type DailyV3RelationshipFactsForMove = Omit<DailyV3RelationshipFacts, "suggested_coaching_move" | "constraints">;

export type DailyV3RelationshipLaneInput = {
  facts: DailyV3RelationshipFacts;
  /** Upstream modules that supplied structured facts only (observability). */
  telemetry_fact_sources: string[];
};

export type DailyV3RelationshipLaneReplySource = "v3_daily_relationship_lane";

export type DailyV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: DailyV3RelationshipLaneReplySource;
  turnPurpose: string;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
};

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/** Rule-derived coaching move label for telemetry and model grounding (not prose). */
export function deriveSuggestedCoachingMoveForDailyFacts(f: DailyV3RelationshipFactsForMove): string {
  if (f.route_kind === "pending_resolution") return "pending_resolution_reminder";
  if (f.route_kind === "refresh_identity") return "refresh_identity_alignment";
  if (f.route_kind === "refresh_commitment") return "refresh_commitment_fit_check";
  if (f.route_kind === "contract_prompt") return "propose_contract";
  if (f.route_kind === "low_pressure_reactivation") return "low_pressure_reactivation";
  if (f.accountability.daily_purpose === "comeback_after_silence") return "acknowledge_comeback";
  if (f.accountability.next_move_type === "shrink_ask") return "invite_smaller_rep";
  if (f.accountability.next_move_type === "hold_standard") return "hold_standard";
  if (f.accountability.blocker_preview) return "ask_blocker";
  if (f.accountability.daily_purpose === "contract_overlay_proposal") return "propose_contract";
  if (f.accountability.daily_purpose === "evolution_pattern_check") return "evolution_check";
  return "ask_completion";
}

function routeSpecificSystemAddendum(f: DailyV3RelationshipFacts): string {
  const lines: string[] = [];
  if (f.route_kind === "pending_resolution") {
    lines.push(
      "PENDING_RESOLUTION_ROUTE: User has an in-flight guided commitment update. Nudge them to complete it in-app or via SMS per facts. Do not invent a new bar or change server state."
    );
  }
  if (f.route_kind === "refresh_identity") {
    lines.push(
      "REFRESH_IDENTITY_ROUTE: Identity alignment check (not a daily score). If constraints.required_verbatim_substrings lists an identity anchor, include that substring EXACTLY once, character-for-character."
    );
  }
  if (f.route_kind === "refresh_commitment") {
    lines.push(
      "REFRESH_COMMITMENT_ROUTE: Ask whether today’s bar still fits. If constraints.required_verbatim_substrings lists the effective bar text, include it EXACTLY once, character-for-character."
    );
  }
  if (f.route_kind === "contract_prompt" && f.contract_proposal) {
    lines.push(
      `CONTRACT_PROMPT_ROUTE: You MUST include this binding text EXACTLY once, verbatim (character-for-character), in the SMS body: ${JSON.stringify(f.contract_proposal.binding_text_verbatim)}. Write a short human relationship wrapper around it; user must be able to reply YES or NO to the binding offer. Do not change binding meaning or add new legal obligations.`
    );
  }
  if (f.constraints.required_verbatim_substrings?.length) {
    lines.push(
      `REQUIRED_VERBATIM: The final body must contain each string in constraints.required_verbatim_substrings exactly (substring match). If you cannot do that safely, return should_send false.`
    );
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  turn_purpose?: unknown;
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

function summarizeFacts(f: DailyV3RelationshipFacts): string {
  const slim = {
    route_kind: f.route_kind,
    daily_purpose: f.accountability.daily_purpose,
    server_strategy: f.accountability.server_strategy,
    next_move: f.accountability.next_move_type,
    prior_outcome: f.accountability.prior_outcome,
    silence_tier: f.accountability.silence_tier,
    suggested_move: f.suggested_coaching_move,
    has_contract: Boolean(f.contract_proposal),
    has_pending: Boolean(f.pending_resolution),
    refresh_step: f.refresh?.refresh_step ?? null,
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

function validateRequiredVerbatims(body: string, required: string[] | undefined): string | null {
  if (!required?.length) return null;
  for (const sub of required) {
    const t = sub.trim();
    if (!t) continue;
    if (!body.includes(t)) return t;
  }
  return null;
}

/** Contract / binding routes: lane repair must not rewrite required verbatim substrings. */
function dailyLanePostValidateRepairExcluded(facts: DailyV3RelationshipFacts): boolean {
  return (
    facts.route_kind === "contract_prompt" ||
    Boolean(facts.constraints.required_verbatim_substrings?.length)
  );
}

/**
 * Produces the next relationship SMS for any daily cron branch.
 * Fail-closed: no deterministic coaching fallback; OpenAI/parse/validation failures → shouldSend false.
 */
export async function produceDailyV3RelationshipSms(
  args: DailyV3RelationshipLaneInput
): Promise<DailyV3RelationshipLaneResult> {
  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    daily_v3_lane_used: true,
    v3_lane_reply_source: "v3_daily_relationship_lane" satisfies DailyV3RelationshipLaneReplySource,
    old_daily_writer_used_as_voice: false,
    old_daily_writer_fact_sources: args.telemetry_fact_sources,
    daily_facts_summary: summarizeFacts(args.facts),
    suggested_coaching_move: args.facts.suggested_coaching_move,
    route_purpose: args.facts.route_kind,
  };

  const empty = (reason: string, openAiOk: boolean, extra?: Record<string, unknown>): DailyV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_daily_relationship_lane",
    turnPurpose: "no_send",
    voiceConfidence: null,
    usedFacts: [],
    safetyNotes: [],
    metadata: { ...baseMeta, ...extra },
    openAiOk,
  });

  const client = getOpenAIClient();
  if (!client) {
    return empty("openai_unavailable", false, { lane_stage: "no_client" });
  }

  const factsJson = JSON.stringify(args.facts);
  const system = `You are writing the NEXT SMS in one long coaching relationship (months of thread). This is not an isolated reminder app.

RULES:
- Use ACCOUNTABILITY_FACTS_JSON only as facts — never copy old template wording or paraphrase labeled machine drafts.
- Anchor to the user's real commitment (effective ask + state), without pasting raw title or behavior_statement as a quoted phrase or "Did [raw] happen today?" / "Did you protect [raw]?" style checks.
- One short SMS, max ${DAILY_LANE_MAX_CHARS} characters, no newlines, one clear question or one concrete action.
- No generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope your", "checking in" as filler).
- If facts say reentry/comeback after silence, acknowledge return briefly before the ask.
- If unsafe, uncertain, or facts conflict badly, return should_send false.
${routeSpecificSystemAddendum(args.facts)}

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[])`;

  const user = `ACCOUNTABILITY_FACTS_JSON (facts only; not copyable prose):
${factsJson.slice(0, 12000)}

Write JSON only.`;

  let laneOpenAiJsonMeta: Record<string, unknown> = {};
  let parsed: LaneModelJson | null = null;
  try {
    const jsonOut = await runLaneOpenAiJsonWithOneRetry<LaneModelJson>({
      client,
      model: "gpt-4o-mini",
      temperature: 0.35,
      maxTokens: 220,
      primaryMessages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      jsonSchemaReminder:
        "Keys: should_send (boolean), body (string), no_send_reason (string|null), turn_purpose (string), voice_confidence (number 0-1 or null), used_facts (string[]), safety_notes (string[]).",
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

  const shouldSend = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const turnPurpose = typeof parsed.turn_purpose === "string" ? parsed.turn_purpose.trim() : "daily_turn";
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);
  const bodyPreview = (s: string) => (s.length > 220 ? `${s.slice(0, 219)}…` : s);
  let successLaneStage: "ok" | "post_validate_repaired" = "ok";
  let successRepairExtra: Record<string, unknown> = {};

  if (!shouldSend) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: noSendReason || "model_no_send",
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "model_no_send",
        v3_candidate_body: "",
      },
      openAiOk: true,
    };
  }

  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body", ...laneOpenAiJsonMeta });
  }
  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "trim_empty", ...laneOpenAiJsonMeta });
  }

  const blocked = detectFinalVoiceBlockedReasons(body);
  if (blocked.length > 0) {
    const { repairable, hard } = partitionFinalVoiceBlockedReasons(blocked);

    if (
      hard.length > 0 ||
      repairable.length === 0 ||
      dailyLanePostValidateRepairExcluded(args.facts)
    ) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...blocked.map((b) => `blocked:${b}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_blocked",
          v3_candidate_body: body,
          blocked_reasons: blocked,
        },
        openAiOk: true,
      };
    }

    const originalCandidateSnapshot = body;

    const repairOut = await repairV3RelationshipLaneBodyWithOpenAI({
      routeKind: "daily",
      routePurpose: args.facts.route_kind,
      originalBody: body,
      blockedReasons: repairable,
      factsJson: args.facts,
    });

    if (!repairOut) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...blocked.map((b) => `blocked:${b}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_repair_failed",
          v3_candidate_body: body,
          blocked_reasons: blocked,
          lane_repair_attempted: true,
          lane_repair_succeeded: false,
          original_blocked_reasons: repairable,
          original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
          repaired_candidate_body: null,
          repaired_blocked_reasons: null,
        },
        openAiOk: true,
      };
    }

    let repaired = repairOut.body.replace(/^["']|["']$/g, "").trim();
    const blockedAfter = detectFinalVoiceBlockedReasons(repaired);
    const missingAfterRepair = validateRequiredVerbatims(
      repaired,
      args.facts.constraints.required_verbatim_substrings
    );

    if (blockedAfter.length > 0 || missingAfterRepair != null) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "lane_post_validate_blocked",
        replySource: "v3_daily_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [
          ...safetyNotes,
          ...blocked.map((b) => `blocked:${b}`),
          ...blockedAfter.map((b) => `repaired_blocked:${b}`),
        ],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_repair_failed",
          v3_candidate_body: originalCandidateSnapshot,
          blocked_reasons: blocked,
          lane_repair_attempted: true,
          lane_repair_succeeded: false,
          original_blocked_reasons: repairable,
          original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
          repaired_candidate_body: repaired,
          repaired_blocked_reasons: [
            ...blockedAfter,
            ...(missingAfterRepair != null ? ["missing_required_verbatim_after_repair"] : []),
          ],
          ...repairOut.metadata,
        },
        openAiOk: true,
      };
    }

    body = repaired;
    successLaneStage = "post_validate_repaired";
    successRepairExtra = {
      lane_repair_attempted: true,
      lane_repair_succeeded: true,
      original_blocked_reasons: repairable,
      original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
      repaired_candidate_body: repaired,
      repaired_blocked_reasons: [],
      ...repairOut.metadata,
    };
  }

  const missingVerb = validateRequiredVerbatims(body, args.facts.constraints.required_verbatim_substrings);
  if (missingVerb != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "missing_required_verbatim",
      replySource: "v3_daily_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `missing_verbatim:${missingVerb.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "verbatim_validation_failed",
        v3_candidate_body: body,
        first_missing_verbatim_preview: missingVerb.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_daily_relationship_lane",
    turnPurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      ...laneOpenAiJsonMeta,
      lane_stage: successLaneStage,
      v3_candidate_body: body,
      ...successRepairExtra,
    },
    openAiOk: true,
  };
}

/** Coaching memory → compact do-not-repeat / pattern hints for the lane (facts only). */
export function deriveDoNotRepeatHintsFromCoachingMemory(m: V2CoachingMemoryForPrompt | null): string[] {
  if (!m) return [];
  const out: string[] = [];
  for (const t of m.blocker_tags ?? []) {
    if (t?.trim()) out.push(`blocker_tag:${t.trim()}`);
  }
  if (m.latest_blocker_preview?.trim()) {
    out.push(`latest_blocker_preview:${m.latest_blocker_preview.trim().slice(0, 120)}`);
  }
  return out.slice(0, 12);
}

/** Bounded memory snippet for prompts (same formatter as V3 daily; facts context). */
export function buildCoachingMemorySnippetForDailyLane(m: V2CoachingMemoryForPrompt | null): string {
  return formatCoachingMemoryPromptBlock(m).slice(0, 1400);
}

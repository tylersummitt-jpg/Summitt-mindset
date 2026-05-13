/**
 * Inbound Central V3 Relationship Lane — Phase 3A/3B (normal active-commitment inbound only).
 * OpenAI authors the visible inbound reply; V2 / brain / templates are facts only (no seed prose).
 */

import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import { detectFinalVoiceBlockedReasons } from "@/lib/v3-sms-voice-ownership";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";

const INBOUND_LANE_MAX_CHARS = 320;

export type InboundV3RoutePurpose = "normal_inbound_reply";

export type InboundV3ConversationBrainFacts = {
  enabled: boolean;
  model?: string | null;
  guardrail_status?: string | null;
  turn_kind?: string | null;
  outcome_confidence?: number | null;
  reply_strategy?: string | null;
  needs_clarification?: boolean | null;
  repeated_clarification_risk?: boolean | null;
  /** Server outcome type the brain approved — not prose. */
  final_event_type?: string | null;
} | null;

export type InboundV3CentralBrainFacts = {
  shadow_stored: boolean;
  central_turn_purpose?: string | null;
  confidence?: number | null;
  /** When true, outbound outcome scoring was blocked (pivot path) — main lane path only receives shadow summary. */
  blocked_outcome_scoring?: boolean | null;
} | null;

export type InboundV3ArcFacts = {
  ambiguous_short_reply?: boolean | null;
  /** When true, ARC would have forced clarification — user stays on main path only if false. */
  clarification_required?: boolean | null;
} | null;

export type InboundV3RelationshipFacts = {
  route_purpose: InboundV3RoutePurpose;
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_time_iso: string;
    relationship_profile_summary: string | null;
  };
  commitment: {
    id: string;
    title: string;
    behavior_statement: string;
    effective_ask: string;
    accountability_phase: string;
  };
  thread: {
    latest_inbound_raw: string;
    /** After rapid-split coalescing when applied upstream; else same as raw. */
    coalesced_inbound_text: string;
    suppressed_message_sids: string[];
    recent_transcript_lines: string[];
    latest_outbound_coach_sms: string | null;
    latest_open_question: string | null;
    expected_reply_semantics: string | null;
    do_not_repeat_hints: string[];
    rejected_time_candidates: string[];
    unavailable_windows: string[];
  };
  v2_accountability: {
    deterministic_classifier_event: "user_yes" | "user_no" | "user_partial";
    gated_mode: string;
    final_event_type: string | null;
    should_write_outcome_event: boolean;
    reply_style: string | null;
    /** Structured only — not prior SMS drafts. */
    proof_signal: boolean;
    miss_signal: boolean;
    blocker_signal: boolean;
    today_completed: boolean;
    future_intent_hint: string | null;
    supplement_commitment_change_guidance: boolean;
  };
  legacy_suggestions: {
    conversation_brain: InboundV3ConversationBrainFacts;
    central_brain: InboundV3CentralBrainFacts;
    arc: InboundV3ArcFacts;
    phase5a: {
      central_tether_brain_enabled: boolean;
      arc_clarify_brain_enabled: boolean;
      inbound_stitched_final_enabled: boolean;
    };
    forced_future_stretch_intent_active: boolean;
    wave11_memory_confirmation_pending: boolean;
    /** Proof / victory structured hints — not appended marketing copy. */
    accountability_proof_hint: string | null;
  };
  suggested_coaching_move: string;
  constraints: {
    max_chars: number;
    one_sms: true;
    no_generic_motivation: true;
    no_quoted_or_truncated_echo_of_inbound: true;
    if_unsafe_return_no_send: true;
    /** Substrings that must NOT appear in body (e.g. rejected times). */
    forbidden_substrings?: string[];
  };
};

export type InboundV3RelationshipLaneInput = {
  facts: InboundV3RelationshipFacts;
  telemetry_fact_sources: string[];
};

export type InboundV3RelationshipLaneReplySource = "v3_inbound_relationship_lane";

export type InboundV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: InboundV3RelationshipLaneReplySource;
  turnPurpose: string;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
};

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  turn_purpose?: unknown;
  voice_confidence?: unknown;
  used_facts?: unknown;
  safety_notes?: unknown;
  rejected_times_obeyed?: unknown;
  split_messages_handled?: unknown;
};

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

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

function summarizeInboundFacts(f: InboundV3RelationshipFacts): string {
  const slim = {
    route_purpose: f.route_purpose,
    gated_mode: f.v2_accountability.gated_mode,
    final_event_type: f.v2_accountability.final_event_type,
    classifier: f.v2_accountability.deterministic_classifier_event,
    suggested_move: f.suggested_coaching_move,
    proof: f.v2_accountability.proof_signal,
    miss: f.v2_accountability.miss_signal,
    wave11_pending: f.legacy_suggestions.wave11_memory_confirmation_pending,
    conversation_brain_on: f.legacy_suggestions.conversation_brain?.enabled ?? false,
    central_shadow: f.legacy_suggestions.central_brain?.shadow_stored ?? false,
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

export function deriveSuggestedCoachingMoveForInboundFacts(f: InboundV3RelationshipFacts): string {
  const ft = f.v2_accountability.final_event_type;
  if (ft === "user_yes") return "acknowledge_completion";
  if (ft === "user_no") return "name_blocker";
  if (ft === "user_partial") return "narrow_blocker";
  if (f.v2_accountability.gated_mode === "clarify") return "clarify_intent";
  return "ask_accountability";
}

function validateForbiddenSubstrings(body: string, forbidden: string[] | undefined): string | null {
  if (!forbidden?.length) return null;
  const lower = body.toLowerCase();
  for (const sub of forbidden) {
    const t = sub.trim();
    if (!t) continue;
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

function validateNoRejectedTimeRepeat(body: string, rejected: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const b = norm(body);
  for (const r of rejected) {
    const t = r.trim();
    if (t.length < 2) continue;
    if (b.includes(norm(t))) return t;
  }
  return null;
}

/**
 * Normal accountability inbound: one relationship turn, JSON-only model output, fail-closed.
 */
export async function produceInboundV3RelationshipSms(
  args: InboundV3RelationshipLaneInput
): Promise<InboundV3RelationshipLaneResult> {
  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    inbound_v3_lane_used: true,
    v3_lane_reply_source: "v3_inbound_relationship_lane" satisfies InboundV3RelationshipLaneReplySource,
    old_inbound_writer_used_as_voice: false,
    old_inbound_writer_fact_sources: args.telemetry_fact_sources,
    inbound_facts_summary: summarizeInboundFacts(args.facts),
    suggested_coaching_move: args.facts.suggested_coaching_move,
    route_purpose: args.facts.route_purpose,
    coalesced_inbound_body: args.facts.thread.coalesced_inbound_text,
    suppressed_message_sids: args.facts.thread.suppressed_message_sids,
    rejected_time_candidates: args.facts.thread.rejected_time_candidates,
    unavailable_windows: args.facts.thread.unavailable_windows,
    voice_writer_chain: ["v3_inbound_relationship_lane", "north_star_validator", "final_voice_gate"],
  };

  const empty = (reason: string, openAiOk: boolean, extra?: Record<string, unknown>): InboundV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_inbound_relationship_lane",
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
  const system = `You are writing the NEXT SMS in one long coaching relationship (months of thread). This is not an isolated ticket, form submission, or chatbot reset.

RULES:
- Use INBOUND_ACCOUNTABILITY_FACTS_JSON only as facts — never copy labeled machine drafts, template banks, or "prior hint" wording as your voice.
- Read the thread: latest inbound, latest outbound coach SMS, transcript lines, and open-question semantics.
- Anchor to the active commitment (effective ask + state). Do not paste raw title or behavior_statement as a quoted check.
- If the user corrected or rejected something in facts, do not repeat it. If rejected_time_candidates or forbidden_substrings list times or phrases, do not include them in your body.
- If multiple recent lines reflect one combined intent, answer the combined meaning (facts may set split_messages_handled).
- One short SMS, max ${INBOUND_LANE_MAX_CHARS} characters, no newlines, one clear coach move.
- No generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope your", "checking in" as filler).
- Do not use: "what's the next concrete move", "Say it straight", or "Let's confirm" plus a rejected time.
- Do not quote or echo long user text; no truncated quotes.
- If unsafe, uncertain, or facts conflict badly, return should_send false.

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[]),
rejected_times_obeyed (boolean), split_messages_handled (boolean)`;

  const user = `INBOUND_ACCOUNTABILITY_FACTS_JSON (facts only; not copyable prose):
${factsJson.slice(0, 12000)}

Write JSON only.`;

  let raw = "";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    return empty("openai_request_failed", true, {
      lane_stage: "openai_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const parsed = safeJsonParse(raw);
  if (!parsed) {
    return empty("invalid_json", true, { lane_stage: "parse", raw_preview: raw.slice(0, 200) });
  }

  const shouldSend = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const turnPurpose = typeof parsed.turn_purpose === "string" ? parsed.turn_purpose.trim() : "inbound_turn";
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);

  if (!shouldSend) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: noSendReason || "model_no_send",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        lane_stage: "model_no_send",
        v3_candidate_body: "",
      },
      openAiOk: true,
    };
  }

  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body" });
  }
  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "trim_empty" });
  }

  if (body.length > args.facts.constraints.max_chars) {
    return empty("over_max_chars", true, { lane_stage: "length", v3_candidate_body: body });
  }

  const rt = args.facts.thread.rejected_time_candidates;
  if (rt.length > 0) {
    const hit = validateNoRejectedTimeRepeat(body, rt);
    if (hit != null) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "rejected_time_repeated",
        replySource: "v3_inbound_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, `rejected_time_repeat:${hit.slice(0, 80)}`],
        metadata: {
          ...baseMeta,
          lane_stage: "rejected_time_validation_failed",
          v3_candidate_body: body,
        },
        openAiOk: true,
      };
    }
  }

  const blocked = detectFinalVoiceBlockedReasons(body);
  if (blocked.length > 0) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "lane_post_validate_blocked",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, ...blocked.map((b) => `blocked:${b}`)],
      metadata: {
        ...baseMeta,
        lane_stage: "post_validate_blocked",
        v3_candidate_body: body,
        blocked_reasons: blocked,
      },
      openAiOk: true,
    };
  }

  const badSub = validateForbiddenSubstrings(body, args.facts.constraints.forbidden_substrings);
  if (badSub != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "forbidden_substring_violation",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `forbidden_hit:${badSub.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        lane_stage: "forbidden_substring",
        v3_candidate_body: body,
        forbidden_hit: badSub.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_inbound_relationship_lane",
    turnPurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      lane_stage: "ok",
      v3_candidate_body: body,
      v3_lane_turn_purpose: turnPurpose,
    },
    openAiOk: true,
  };
}

export type BuildInboundV3RelationshipFactsArgs = {
  clerkUserId: string;
  preferredName: string | null;
  timezone: string;
  localTimeIso: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  userMessageRaw: string;
  coalescedInboundText: string;
  suppressedMessageSids: string[];
  transcriptLines: string[];
  northStarPacket: NorthStarSmsContextPacket;
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: "user_yes" | "user_no" | "user_partial";
  doNotRepeatHints: string[];
  relationshipProfileSummary: string | null;
  conversationBrain: InboundV3ConversationBrainFacts;
  centralBrain: InboundV3CentralBrainFacts;
  arc: InboundV3ArcFacts;
  phase5a: InboundV3RelationshipFacts["legacy_suggestions"]["phase5a"];
  forcedFutureStretchIntentActive: boolean;
  wave11MemoryConfirmationPending: boolean;
  accountabilityProofHint: string | null;
  rejectedTimeCandidates: string[];
  unavailableWindows: string[];
};

/** Assembles JSON-safe facts for {@link produceInboundV3RelationshipSms} (no upstream prose). */
export function buildInboundV3RelationshipFacts(args: BuildInboundV3RelationshipFactsArgs): InboundV3RelationshipFacts {
  const facts: InboundV3RelationshipFacts = {
    route_purpose: "normal_inbound_reply",
    user: {
      clerk_user_id: args.clerkUserId,
      preferred_name: args.preferredName,
      timezone: args.timezone,
      local_time_iso: args.localTimeIso,
      relationship_profile_summary: args.relationshipProfileSummary,
    },
    commitment: {
      id: args.commitment.id,
      title: args.commitment.title,
      behavior_statement: args.commitment.behavior_statement ?? "",
      effective_ask: args.effectiveAsk,
      accountability_phase: args.commitment.accountability_phase,
    },
    thread: {
      latest_inbound_raw: args.userMessageRaw,
      coalesced_inbound_text: args.coalescedInboundText,
      suppressed_message_sids: args.suppressedMessageSids,
      recent_transcript_lines: args.transcriptLines,
      latest_outbound_coach_sms: args.northStarPacket.latestOutboundBody ?? null,
      latest_open_question: args.northStarPacket.latestOpenQuestion ?? null,
      expected_reply_semantics: args.northStarPacket.expectedReplySemantics ?? null,
      do_not_repeat_hints: args.doNotRepeatHints,
      rejected_time_candidates: args.rejectedTimeCandidates,
      unavailable_windows: args.unavailableWindows,
    },
    v2_accountability: {
      deterministic_classifier_event: args.deterministicEventType,
      gated_mode: args.gatedDecision.mode,
      final_event_type: args.gatedDecision.final_event_type ?? null,
      should_write_outcome_event: args.gatedDecision.should_write_outcome_event,
      reply_style: args.gatedDecision.reply_style ?? null,
      proof_signal: args.northStarPacket.proofSignal === true,
      miss_signal: args.northStarPacket.missSignal === true,
      blocker_signal: args.northStarPacket.blockerSignal === true,
      today_completed: args.northStarPacket.todayCompleted === true,
      future_intent_hint: args.northStarPacket.futureIntentHint ?? null,
      supplement_commitment_change_guidance: args.gatedDecision.supplement_commitment_change_guidance === true,
    },
    legacy_suggestions: {
      conversation_brain: args.conversationBrain,
      central_brain: args.centralBrain,
      arc: args.arc,
      phase5a: args.phase5a,
      forced_future_stretch_intent_active: args.forcedFutureStretchIntentActive,
      wave11_memory_confirmation_pending: args.wave11MemoryConfirmationPending,
      accountability_proof_hint: args.accountabilityProofHint,
    },
    suggested_coaching_move: "",
    constraints: {
      max_chars: INBOUND_LANE_MAX_CHARS,
      one_sms: true,
      no_generic_motivation: true,
      no_quoted_or_truncated_echo_of_inbound: true,
      if_unsafe_return_no_send: true,
      forbidden_substrings: [
        "what's the next concrete move",
        "what’s the next concrete move",
        "Say it straight",
        "Let's confirm",
      ],
    },
  };
  facts.suggested_coaching_move = deriveSuggestedCoachingMoveForInboundFacts(facts);
  return facts;
}

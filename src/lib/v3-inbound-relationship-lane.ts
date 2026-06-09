/**
 * Inbound Central V3 Relationship Lane — Phase 3A/3B (normal active-commitment inbound) + 3D-a/3D-b
 * (central_brain_pivot, arc_clarify_ambiguous_short, central_brain_blocker_pivot, blocker_capture_ack)
 * + 3C (open_question_answer) + 3E (refresh, pending_resolution, memory confirmation).
 * OpenAI authors the visible inbound reply; V2 / brain / templates are facts only (no seed prose).
 */

import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import type { V2InboundGatedDecision, V2InboundShadowInterpretationResult } from "@/lib/v2-ai-inbound";
import type { V2SmsCommitmentIntentPack } from "@/lib/v2-sms-commitment-change";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import {
  buildInboundMeaningFacts,
  buildInboundMeaningRoutePriorityFromV3BuildArgs,
  buildInboundMeaningAuthorityLaneGuardrails,
  coachingMoveFromSmsResponseIntent,
  inboundMeaningAuthorizesTodayCompleted,
  isInboundReportedCompletionForAntiGhost,
  reconcileLegacyAccountabilityEventTypeFromMeaning,
  type InboundMeaningFacts,
} from "@/lib/inbound-relationship-meaning";
import {
  applySmsMemoryAntiRepeatGuard,
  buildAntiRepeatDetectArgsFromInboundFacts,
  detectSmsMemoryRepeatViolation,
  shouldRunInboundMemoryRepeatGuard,
} from "@/lib/sms-memory-anti-repeat";
import {
  evaluateRelationshipVoiceWithPraisePolicy,
  partitionFinalVoiceBlockedReasons,
  runLanePostValidateRepairLoop,
  type LanePostValidateRepairValidationResult,
  repairV3RelationshipLaneBodyWithOpenAI,
} from "@/lib/v3-sms-voice-ownership";
import {
  buildSmsPraisePolicyArgsFromInboundFacts,
  type SmsPraisePolicyEvaluateArgs,
} from "@/lib/sms-earned-praise-policy";
import {
  buildInboundPendingReplacementFactsFromCommitment,
  detectPendingReplacementStateTruthViolations,
  detectSeasonTransitionTruthViolations,
  pendingReplacementStateTruthNoSendReason,
  seasonTransitionTruthNoSendReason,
  type InboundV3PendingReplacementFacts,
  type InboundV3SeasonTransitionFacts,
} from "@/lib/v3-inbound-pending-replacement-truth";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import {
  buildSmsGoalAdjustmentLaneGuardrails,
  type SmsGoalAdjustmentSignalResult,
} from "@/lib/sms-goal-adjustment-signal";
import {
  buildSmsPatternSignalLaneGuardrails,
  type SmsPatternSignalResult,
} from "@/lib/sms-pattern-signal";
import { buildPlannedInterruptionLaneGuardrails } from "@/lib/sms-planned-interruption";
import {
  buildRelationshipExitLaneGuardrails,
  type InboundV3RelationshipExitFacts,
} from "@/lib/sms-relationship-exit-intent";
import {
  buildIdentityEditLaneGuardrails,
  type InboundV3IdentityEditFacts,
} from "@/lib/sms-identity-edit-intent";
import type { InboundPriorMemoryRepeatNoSendContext } from "@/lib/inbound-completion-memory-repeat-escalation";
import type { InboundV3ProofCalloutHint } from "@/lib/v2-proof-moment";
import {
  buildVictoryBackgroundLaneGuardrails,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";
import type { SlimSmsRelationshipMemoryPacketForFacts } from "@/lib/sms-relationship-memory-packet";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipMemory30dResult } from "@/lib/sms-relationship-memory-30d";
import {
  buildRelationshipPacketForOpenAI,
  buildRelationshipPacketPromptGuidance,
  relationshipPacketMetaForLaneTelemetry,
} from "@/lib/sms-relationship-packet-v1";
import { prepareRepairSnapshotForOpenAI } from "@/lib/sms-relationship-repair-snapshot-v1";
import {
  applyThreadFreshnessGuard,
  buildThreadFreshnessPromptGuidance,
  deriveRecentThreadFreshnessFacts,
  detectThreadFreshnessViolations,
  type ThreadFreshnessFacts,
} from "@/lib/sms-thread-freshness";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import { buildTemporalContractForInbound } from "@/lib/sms-temporal-contract-v1";
import {
  buildTurnUnderstandingLaneGuardrails,
  coachingMoveFromReconciledResponseIntent,
  isTurnUnderstandingAuthoritative,
  reconciledTurnUnderstandingOverridesOpenQuestionFacts,
  slimTurnUnderstandingMetadata,
  type ReconciledTurnUnderstanding,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  detectTurnUnderstandingStaleAskViolationFromFacts,
  paraphraseRepeatsStaleCoachAsk,
  tryRepairInboundStaleAskViolation,
} from "@/lib/inbound-turn-understanding-context";
import {
  buildStrategyCardContextFromSnapshot,
  buildStrategyCardV1PromptGuidance,
  buildInboundNormalStrategyCardV1,
  isInboundNormalStrategyCardEligible,
  strategyCardV1MetaForTelemetry,
  strategyCardV1UserPromptAppendix,
  validateAndRepairInboundNormalStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import {
  buildSingleMissRecoveryLaneGuardrails,
  buildSingleMissRecoveryRequiredMeaningSummary,
  deriveAdjustmentProposalAllowedByEvidence,
  type MissAdjustmentPolicyResult,
} from "@/lib/inbound-miss-adjustment-policy";
import { isV2PendingProposalValid } from "@/lib/v2-adaptive-contract";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const INBOUND_LANE_MAX_CHARS = 320;

export type InboundV3RoutePurpose =
  | "normal_inbound_reply"
  | "central_brain_pivot"
  | "arc_clarify_ambiguous_short"
  | "central_brain_blocker_pivot"
  | "blocker_capture_ack"
  | "open_question_answer"
  | "refresh"
  | "refresh_identity"
  | "refresh_commitment"
  | "refresh_confirmation"
  | "refresh_clarification"
  | "pending_resolution"
  | "memory_confirmation"
  | "memory_decline"
  | "memory_clarification"
  | "adaptive_proposal_consent_accept"
  | "adaptive_proposal_consent_decline"
  | "adaptive_proposal_consent_noop_ack"
  | "adaptive_proposal_consent_clarification"
  | "commitment_change_handoff"
  /** Heuristic commitment-change phrasing without Wave4 handoff — no pending resolution on this branch. */
  | "commitment_change_context"
  /** Slice D-lite — exit / subscription integrity; no accountability outcome event. */
  | "relationship_exit_integrity"
  /** Slice B Phase 1 — identity clarification; no identity or goal mutation. */
  | "identity_edit_integrity"
  /** Conversation brain control unavailable / legacy deterministic SMS disabled — template is facts-only. */
  | "conversation_brain_unavailable";

/** Routes where short-ack / already-told-you thread correction must not override consent or transactional flows. */
const THREAD_MEMORY_CORRECTION_ROUTE_PURPOSES = new Set<InboundV3RoutePurpose>(["normal_inbound_reply"]);

function normThreadText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseTranscriptRoleLine(line: string): { role: "Coach" | "User" | null; text: string } {
  const mCoach = /^\s*Coach:\s*(.+)$/i.exec(line);
  if (mCoach?.[1]) return { role: "Coach", text: mCoach[1].trim() };
  const mUser = /^\s*User:\s*(.+)$/i.exec(line);
  if (mUser?.[1]) return { role: "User", text: mUser[1].trim() };
  return { role: null, text: line.trim() };
}

/** User is correcting the coach for forgetting a recent answer. */
export function isAlreadyToldYouCorrection(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bi\s+already\s+told\s+you\b/i.test(t)) return true;
  if (/\balready\s+told\s+you\b/i.test(t)) return true;
  if (/\bi\s+told\s+you\s+already\b/i.test(t)) return true;
  if (/\btold\s+you\s+already\b/i.test(t)) return true;
  if (/\bi\s+already\s+answered\b/i.test(t)) return true;
  if (/\balready\s+answered\b/i.test(t)) return true;
  if (/\bi\s+said\s+that\b/i.test(t)) return true;
  if (/\bi\s+just\s+told\s+you\b/i.test(t)) return true;
  return false;
}

const SHORT_ACK_CORE = new Set([
  "ok",
  "okay",
  "k",
  "got it",
  "gotit",
  "sounds good",
  "sounds good!",
  "👍",
  "thumbs up",
]);

function isEmojiOnlyInbound(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^👍[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*$/u.test(t)) return true;
  if (/^[\p{Extended_Pictographic}\s]+$/u.test(t) && t.length <= 8) return true;
  return false;
}

function isShortAckPhraseCore(text: string): boolean {
  const core = normThreadText(text).replace(/[.!?…]+$/g, "");
  if (!core) return false;
  if (SHORT_ACK_CORE.has(core)) return true;
  if (core === "thumbs up" || core === "thumbs-up") return true;
  return false;
}

/** Conservative short receipt — not YES/NO consent or substantive answers. */
export function isShortAcknowledgement(text: string, routePurpose: InboundV3RoutePurpose): boolean {
  if (!THREAD_MEMORY_CORRECTION_ROUTE_PURPOSES.has(routePurpose)) return false;
  const t = text.trim();
  if (!t) return false;
  if (isAlreadyToldYouCorrection(t)) return false;
  if (isEmojiOnlyInbound(t)) return true;
  if (isShortAckPhraseCore(t)) return true;
  return false;
}

function isNonSubstantiveUserLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isAlreadyToldYouCorrection(t)) return true;
  if (isEmojiOnlyInbound(t)) return true;
  if (isShortAckPhraseCore(t)) return true;
  return false;
}

function isSubstantiveUserMessage(text: string): boolean {
  const t = text.trim();
  if (!t || isNonSubstantiveUserLine(t)) return false;
  if (t.length >= 12) return true;
  if (/,/.test(t) && t.length >= 5) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  return false;
}

/** Latest prior User line that is substantive (not current inbound, not ack/correction). */
export function extractMostRecentSubstantivePriorUserMessage(
  recentTranscriptLines: string[],
  currentInbound: string
): string | null {
  const currentNorm = normThreadText(currentInbound);
  for (let i = recentTranscriptLines.length - 1; i >= 0; i--) {
    const parsed = parseTranscriptRoleLine(recentTranscriptLines[i] ?? "");
    if (parsed.role !== "User") continue;
    if (normThreadText(parsed.text) === currentNorm) continue;
    if (!isSubstantiveUserMessage(parsed.text)) continue;
    return parsed.text;
  }
  return null;
}

function coachLineLooksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (/\b(what|when|which|who|how|tell me|give me|pick|choose)\b/i.test(t)) return true;
  return false;
}

/** Latest Coach line that looks like a question/ask. */
export function extractMostRecentCoachQuestion(recentTranscriptLines: string[]): string | null {
  for (let i = recentTranscriptLines.length - 1; i >= 0; i--) {
    const parsed = parseTranscriptRoleLine(recentTranscriptLines[i] ?? "");
    if (parsed.role !== "Coach") continue;
    if (!coachLineLooksLikeQuestion(parsed.text)) continue;
    return parsed.text;
  }
  return null;
}

export type InboundThreadMemoryCorrectionFields = {
  current_inbound_is_already_told_you_correction: boolean;
  current_inbound_is_short_acknowledgement: boolean;
  most_recent_substantive_prior_user_message: string | null;
  most_recent_coach_question: string | null;
  memory_correction_should_use_prior_user_answer: boolean;
  short_ack_should_not_reask_question: boolean;
};

export function deriveInboundThreadMemoryCorrectionFields(args: {
  recentTranscriptLines: string[];
  currentInbound: string;
  routePurpose: InboundV3RoutePurpose;
}): InboundThreadMemoryCorrectionFields {
  const inbound = args.currentInbound.trim();
  const routeOk = THREAD_MEMORY_CORRECTION_ROUTE_PURPOSES.has(args.routePurpose);
  const alreadyTold = routeOk && isAlreadyToldYouCorrection(inbound);
  const shortAck = routeOk && isShortAcknowledgement(inbound, args.routePurpose);
  const priorUser = routeOk
    ? extractMostRecentSubstantivePriorUserMessage(args.recentTranscriptLines, inbound)
    : null;
  const coachQ = routeOk ? extractMostRecentCoachQuestion(args.recentTranscriptLines) : null;

  return {
    current_inbound_is_already_told_you_correction: alreadyTold,
    current_inbound_is_short_acknowledgement: shortAck,
    most_recent_substantive_prior_user_message: priorUser,
    most_recent_coach_question: coachQ,
    memory_correction_should_use_prior_user_answer: alreadyTold && Boolean(priorUser?.trim()),
    short_ack_should_not_reask_question: shortAck && Boolean(priorUser?.trim()),
  };
}

/** Blocks outbound SMS that repeats a coach ask listed in turn_understanding.do_not_repeat_asks. */
export function detectTurnUnderstandingStaleAskViolation(
  body: string,
  facts: InboundV3RelationshipFacts
): { violation: boolean; repeatedPhrase: string | null } {
  return detectTurnUnderstandingStaleAskViolationFromFacts(body, facts);
}

async function tryResolveStaleAskBlockedInboundBody(
  body: string,
  args: InboundV3RelationshipLaneInput,
  staleAsk: { violation: boolean; repeatedPhrase: string | null }
): Promise<
  | { ok: true; body: string; repairMeta: Record<string, unknown> }
  | { ok: false; repairMeta: Record<string, unknown> }
> {
  const tu = args.facts.turn_understanding;
  if (!tu || !isTurnUnderstandingAuthoritative(tu)) {
    return { ok: false, repairMeta: {} };
  }

  const repaired = await tryRepairInboundStaleAskViolation({
    body,
    violation: staleAsk,
    reconciled: tu,
    latestOpenQuestion:
      args.facts.thread.latest_open_question ??
      args.facts.thread.memory_packet?.latest_open_question ??
      null,
    lastCoachOutbound:
      args.facts.thread.memory_packet?.last_outbound_full_body ??
      args.facts.thread.latest_outbound_coach_sms ??
      null,
    rawInbound: args.facts.thread.coalesced_inbound_text ?? null,
    inboundMeaning: args.facts.inbound_meaning,
    routePurpose: args.facts.route_purpose,
    factsJson: args.facts as unknown as Record<string, unknown>,
  });

  if (!repaired?.body) {
    return {
      ok: false,
      repairMeta: {
        turn_understanding_stale_ask_repair_attempted: true,
        turn_understanding_stale_ask_repair_succeeded: false,
      },
    };
  }

  const recheck = detectTurnUnderstandingStaleAskViolation(repaired.body, args.facts);
  if (recheck.violation) {
    return {
      ok: false,
      repairMeta: {
        ...repaired.metadata,
        turn_understanding_stale_ask_repair_succeeded: false,
      },
    };
  }

  return {
    ok: true,
    body: repaired.body,
    repairMeta: {
      ...repaired.metadata,
      turn_understanding_stale_ask_repair_succeeded: true,
    },
  };
}

function inboundBodyReasksThreadQuestion(body: string, facts: InboundV3RelationshipFacts): boolean {
  const tu = facts.turn_understanding;
  if (
    !facts.thread.memory_correction_should_use_prior_user_answer &&
    !facts.thread.short_ack_should_not_reask_question &&
    !facts.thread.latest_answer_after_open_question?.trim() &&
    !facts.thread.memory_packet?.latest_answer_after_open_question?.trim() &&
    !facts.thread.memory_packet?.latest_answer_after_open_question_guess &&
    !(
      tu &&
      isTurnUnderstandingAuthoritative(tu) &&
      (tu.last_ask_satisfied === "yes" || tu.stale_ask_risk) &&
      tu.reconciled_do_not_repeat_asks.length > 0
    )
  ) {
    return false;
  }
  const targets = [
    facts.thread.most_recent_coach_question,
    facts.thread.latest_open_question,
    facts.thread.memory_packet?.latest_open_question,
    facts.thread.memory_packet?.latest_open_question_guess,
    ...(facts.thread.memory_packet?.last_5_coach_questions ?? []),
  ].filter((t): t is string => Boolean(t?.trim()));
  for (const t of targets) {
    if (paraphraseRepeatsStaleCoachAsk(body, t)) return true;
  }
  if (/\bwhat\s+story\s+will\s+you\s+dictate\b/i.test(body)) return true;
  return false;
}

function buildThreadMemoryCorrectionRouteAux(f: InboundV3RelationshipFacts): string {
  const lines: string[] = [];
  const prior = f.thread.most_recent_substantive_prior_user_message?.trim();
  const coachQ = f.thread.most_recent_coach_question?.trim();

  if (f.thread.current_inbound_is_already_told_you_correction) {
    lines.push(
      "ALREADY_TOLD_YOU_CORRECTION: The user is saying you forgot their recent answer. Start with a brief ownership line (e.g. \"You're right — you did.\" or \"You're right, I missed that.\").",
      prior
        ? `Use this as their answer (do NOT substitute older memory): "${prior}".`
        : "Use the most recent substantive User line in recent_transcript_lines — not older coaching memory.",
      coachQ
        ? `Do NOT ask again: "${coachQ.slice(0, 200)}".`
        : "Do NOT repeat the latest coach question from the thread.",
      "One short SMS. Move forward from their answer. No new accountability question."
    );
  }

  if (f.thread.short_ack_should_not_reask_question) {
    lines.push(
      "SHORT_ACK_RECEIPT: The user's latest message is only a brief acknowledgment (e.g. thumbs up / ok / got it) after they already gave a substantive answer.",
      prior
        ? `Their substantive answer to honor: "${prior}".`
        : "Find the latest substantive User line in recent_transcript_lines.",
      "Send a brief forward-moving acknowledgment with NO question mark and NO new ask (do not ask what story / what time / did you again).",
      coachQ
        ? `Especially do NOT repeat: "${coachQ.slice(0, 200)}".`
        : "Do not restart the same coach question loop."
    );
  }

  if (!lines.length) return "";
  return `

THREAD_MEMORY_CORRECTION (server-owned; overrides generic accountability re-asks):
${lines.map((l) => `- ${l}`).join("\n")}`;
}

function buildMemoryPacketRouteAux(f: InboundV3RelationshipFacts): string {
  const mp = f.thread.memory_packet;
  if (!mp) return "";
  const lines: string[] = [
    "Use RELATIONSHIP_PACKET_V1.recent_exact_thread_72h as the authoritative recent thread — do not rely on duplicated thread blobs elsewhere in this prompt.",
    "RECENT_EXACT_THREAD is highest-priority memory — it outranks coaching summaries and older transcript lines when they conflict.",
    "Do NOT ask any question in memory_packet.last_5_coach_questions unless the user clearly has not answered and you briefly acknowledge that.",
  ];
  if (mp.projection_used && mp.open_question_pending === false && mp.latest_answer_after_open_question?.trim()) {
    lines.push(
      `Server-owned answer (projection) — do NOT ask again: "${mp.latest_answer_after_open_question.trim().slice(0, 220)}".`
    );
  } else if (mp.latest_answer_after_open_question?.trim()) {
    lines.push(
      `User already answered the open question — use this answer and do NOT ask again: "${mp.latest_answer_after_open_question.trim().slice(0, 220)}".`
    );
  } else if (mp.latest_answer_after_open_question_guess?.trim()) {
    lines.push(
      `User likely answered (runtime guess) — use: "${mp.latest_answer_after_open_question_guess.trim().slice(0, 220)}".`
    );
  } else if (mp.latest_open_question?.trim()) {
    const src = mp.open_question_source === "projection" ? "projection" : "thread";
    lines.push(
      `Latest open coach question (${src}): "${mp.latest_open_question.trim().slice(0, 200)}" — only re-ask if user has not substantively answered since.`
    );
  } else if (mp.latest_open_question_guess?.trim()) {
    lines.push(
      `Latest open coach question (runtime guess): "${mp.latest_open_question_guess.trim().slice(0, 200)}" — only re-ask if user has not substantively answered since.`
    );
  }
  if (mp.do_not_repeat_phrases.length) {
    lines.push(
      `Do not repeat these coach phrases/questions: ${mp.do_not_repeat_phrases
        .slice(0, 6)
        .map((p) => `"${p.slice(0, 100)}"`)
        .join("; ")}.`
    );
  }
  if (f.thread.current_inbound_is_already_told_you_correction && mp.last_substantive_user_message?.trim()) {
    lines.push(
      `ALREADY_TOLD_YOU: honor memory_packet.last_substantive_user_message: "${mp.last_substantive_user_message.trim().slice(0, 220)}". Apologize briefly; do not substitute older memory.`
    );
  }
  return `

MEMORY_PACKET (server-owned; RECENT_EXACT_THREAD wins over COACHING_SUMMARY):
${lines.map((l) => `- ${l}`).join("\n")}`;
}

function enhanceThreadCorrectionFromMemoryPacket(
  base: InboundThreadMemoryCorrectionFields,
  packet: SlimSmsRelationshipMemoryPacketForFacts | undefined,
  routePurpose: InboundV3RoutePurpose
): InboundThreadMemoryCorrectionFields {
  if (!packet || !THREAD_MEMORY_CORRECTION_ROUTE_PURPOSES.has(routePurpose)) return base;
  const priorPacket = packet.last_substantive_user_message?.trim() || null;
  const coachPacket =
    packet.last_5_coach_questions.at(-1)?.trim() ||
    packet.latest_open_question?.trim() ||
    packet.latest_open_question_guess?.trim() ||
    null;
  const prior =
    base.most_recent_substantive_prior_user_message?.trim() ||
    priorPacket ||
    packet.latest_answer_after_open_question?.trim() ||
    packet.latest_answer_after_open_question_guess?.trim() ||
    null;
  const coachQ = base.most_recent_coach_question?.trim() || coachPacket || null;
  return {
    ...base,
    most_recent_substantive_prior_user_message: prior,
    most_recent_coach_question: coachQ,
    memory_correction_should_use_prior_user_answer:
      base.memory_correction_should_use_prior_user_answer ||
      (base.current_inbound_is_already_told_you_correction && Boolean(prior)),
    short_ack_should_not_reask_question:
      base.short_ack_should_not_reask_question ||
      (base.current_inbound_is_short_acknowledgement && Boolean(prior)),
  };
}

/** Pending adaptive proposal — user has not given clear YES/NO; server has taken no consent action. */
export type InboundV3AdaptiveConsentClarificationFacts = {
  latest_outbound_was_proposal: boolean;
  pending_proposal_valid: boolean;
  proposal_kind: string;
  proposal_text_digest: string;
  inbound_parse: "ambiguous" | "question" | "explanation_request" | "consent_adjacent";
  server_action_taken: "none";
  state_remains_pending: true;
  required_meaning_summary: string;
  /** Non-speakable deterministic stub — metadata only. */
  legacy_clarification_preview: string;
  inbound_message_sid: string;
};

export type InboundV3CommsPreferencesFacts = {
  comms_preference_action: string;
  preference_write_ok: boolean;
  pause_active: boolean;
  pause_until_iso: string | null;
  pause_reason_category: string | null;
  cadence_override: string | null;
  weekend_send_policy: string | null;
  preferred_send_window: string | null;
  preferred_local_hour: number | null;
  needs_cadence_clarification: boolean;
  required_meaning_summary: string;
};

export type InboundV3CommitmentChangeFacts = {
  detected_intent_type: V2SmsCommitmentIntentPack["intent"];
  current_commitment_snapshot: string;
  requested_change_summary: string;
  pending_resolution_created: boolean;
  pending_resolution_type: "commitment_tighten" | "commitment_replace" | null;
  pending_resolution_skip_reason: string | null;
  /** Populated when `applyWave4SmsCommitmentPendingResolution` threw before returning a result. */
  pending_resolution_apply_exception: string | null;
  existing_pending_resolution: boolean;
  candidate_tightened_bar_preview: string | null;
  candidate_new_bar_preview: string | null;
  server_state_transition_summary: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary: string;
  /** Non-speakable legacy Wave4 coach string — metadata only. */
  legacy_commitment_change_reply_preview: string;
  /** Non-speakable note that would have been merged in the old path — metadata only. */
  append_note_preview: string | null;
  inbound_message_sid: string;
};

export type Wave4SmsPendingApplyResult = {
  pendingApplied: boolean;
  pendingKind: import("@/lib/v2-guided-resolution").V2PendingResolutionKind | null;
  skipReason: import("@/lib/v2-sms-commitment-change").Wave4PendingSkipReason | null;
};

const INBOUND_COMMITMENT_CHANGE_EXISTING_PENDING_NOTE =
  "You already have a commitment update in progress—reply here to finish it before starting another.";

/**
 * Server-only facts for commitment_change_handoff inbound lane (no user-visible prose authority).
 */
export type CommitmentChangeBootstrapFacts = {
  promoted: boolean;
  candidatePreview: string | null;
};

export function buildCommitmentChangeInboundFactsFromWave4(args: {
  intentPack: V2SmsCommitmentIntentPack;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  userMessage: string;
  messageSid: string;
  wave4: Wave4SmsPendingApplyResult;
  pendingResolutionApplyException: string | null;
  /** Non-speakable legacy Wave4 coach string — pass from `buildSmsCommitmentChangeCoachReply` at the route layer. */
  legacyCommitmentChangeReplyPreview: string;
  bootstrapResult?: CommitmentChangeBootstrapFacts | null;
}): InboundV3CommitmentChangeFacts {
  const legacy = args.legacyCommitmentChangeReplyPreview.trim();
  const legacyPreview = legacy.length > 500 ? `${legacy.slice(0, 497)}...` : legacy;
  const existingPending = args.wave4.skipReason === "existing_pending";
  const appendPreview = existingPending ? INBOUND_COMMITMENT_CHANGE_EXISTING_PENDING_NOTE : null;

  const pendingCreated = args.wave4.pendingApplied === true;
  const pk = args.wave4.pendingKind;
  const pendingType: "commitment_tighten" | "commitment_replace" | null =
    pendingCreated && (pk === "commitment_tighten" || pk === "commitment_replace") ? pk : null;

  let serverSummary: string;
  if (args.pendingResolutionApplyException?.trim()) {
    serverSummary = `pending_resolution_apply_failed:${args.pendingResolutionApplyException.trim().slice(0, 160)}`;
  } else if (pendingCreated && pendingType === "commitment_tighten") {
    serverSummary = "pending_resolution_upserted:commitment_tighten";
    if (args.bootstrapResult?.promoted === true) {
      serverSummary += ";bootstrap:awaiting_confirmation";
    }
  } else if (pendingCreated && pendingType === "commitment_replace") {
    serverSummary = "pending_resolution_upserted:commitment_replace";
    if (args.bootstrapResult?.promoted === true) {
      serverSummary += ";bootstrap:awaiting_confirmation";
    }
  } else if (args.wave4.skipReason === "soft_quit") {
    serverSummary = "pending_resolution_skipped:soft_quit";
  } else if (args.wave4.skipReason === "paused_reactivation") {
    serverSummary = "pending_resolution_skipped:paused_reactivation";
  } else if (args.wave4.skipReason === "refresh_session_active") {
    serverSummary = "pending_resolution_skipped:refresh_session_active";
  } else if (args.wave4.skipReason === "existing_pending") {
    serverSummary = "pending_resolution_skipped:existing_pending";
  } else {
    serverSummary = "pending_resolution_unchanged";
  }

  const snapParts = [
    `title:${args.commitment.title?.trim().slice(0, 80) ?? ""}`,
    `behavior:${(args.commitment.behavior_statement ?? "").trim().replace(/\s+/g, " ").slice(0, 200)}`,
    `effective_ask:${args.effectiveAsk.trim().replace(/\s+/g, " ").slice(0, 200)}`,
  ];
  const currentCommitmentSnapshot = snapParts.join(" | ");

  const bootPreview = args.bootstrapResult?.promoted
    ? args.bootstrapResult.candidatePreview?.trim().replace(/\s+/g, " ").slice(0, 200) ?? null
    : null;

  const reqLines: string[] = [
    "Server state is already decided from facts — do not invent commitment terms or claim the written commitment row already changed.",
    "If pending_resolution_created is true: an SMS update flow was started — explain the honest next step without claiming the commitment is permanently rewritten or locked in.",
    "If pending_resolution_created is false: do not imply a new pending SMS update was created; do not promise a DB commitment mutation occurred.",
    "If existing_pending_resolution is true: communicate that the user should finish the current in-flight commitment update before starting another (meaning may paraphrase; do not quote legacy preview).",
    "legacy_commitment_change_reply_preview and append_note_preview are NON-SPEAKABLE metadata — do not quote, imitate, paste, or treat them as your voice.",
  ];
  if (args.intentPack.intent === "sms_raise_bar_request") {
    reqLines.push(
      "detected_intent_type is sms_raise_bar_request: invite the user to name a harder daily bar and confirm — do not claim the goal was raised or changed before server confirmation."
    );
  }
  if (bootPreview) {
    reqLines.push(
      `Bootstrap awaiting_confirmation holds candidate preview only — user must confirm before any mutation (preview: ${bootPreview}).`
    );
  }
  if (appendPreview) {
    reqLines.push(
      `Honor the meaning of the in-flight update constraint (same intent as append_note_preview) without pasting that text verbatim unless it appears in constraints.required_verbatim_substrings.`
    );
  }

  const requiredVerbatim =
    appendPreview && appendPreview.length > 0 ? [appendPreview] : undefined;

  return {
    detected_intent_type: args.intentPack.intent,
    current_commitment_snapshot: currentCommitmentSnapshot,
    requested_change_summary: args.userMessage.trim().replace(/\s+/g, " ").slice(0, 320),
    pending_resolution_created: pendingCreated,
    pending_resolution_type: pendingType,
    pending_resolution_skip_reason: args.wave4.skipReason,
    pending_resolution_apply_exception: args.pendingResolutionApplyException?.trim() || null,
    existing_pending_resolution: Boolean(existingPending),
    candidate_tightened_bar_preview: args.intentPack.candidateTightenedBar?.trim()
      ? args.intentPack.candidateTightenedBar.trim().replace(/\s+/g, " ").slice(0, 200)
      : null,
    candidate_new_bar_preview:
      bootPreview ??
      (args.intentPack.candidateNewBar?.trim()
        ? args.intentPack.candidateNewBar.trim().replace(/\s+/g, " ").slice(0, 200)
        : null),
    server_state_transition_summary: serverSummary,
    ...(requiredVerbatim ? { required_verbatim_substrings: requiredVerbatim } : {}),
    required_meaning_summary: reqLines.join(" "),
    legacy_commitment_change_reply_preview: legacyPreview,
    append_note_preview: appendPreview,
    inbound_message_sid: args.messageSid,
  };
}

/**
 * Heuristic commitment-change wording while server `gated_mode` is not `commitment_change_handoff`.
 * No Wave4 pending resolution on this branch — facts-only for the lane.
 */
export type InboundV3CommitmentChangeContextFacts = {
  heuristic_commitment_change_intent: true;
  gated_mode: string;
  /** This branch is not the Wave4 handoff lane; no pending resolution was started here. */
  server_decision: "not_handoff";
  current_commitment_snapshot: string;
  user_message_preview: string;
  requested_change_summary: string | null;
  no_state_change_taken: true;
  required_meaning_summary: string;
  inbound_message_sid: string;
};

export function buildCommitmentChangeContextFactsForHeuristicInbound(args: {
  commitment: ActiveV2CommitmentRow;
  userMessage: string;
  messageSid: string;
  gatedMode: string;
  shadowInterpretation: V2InboundShadowInterpretationResult | null;
}): InboundV3CommitmentChangeContextFacts {
  const snapParts = [
    `title:${args.commitment.title?.trim().slice(0, 80) ?? ""}`,
    `behavior:${(args.commitment.behavior_statement ?? "").trim().replace(/\s+/g, " ").slice(0, 200)}`,
  ];
  const currentCommitmentSnapshot = snapParts.join(" | ");
  const preview = args.userMessage.trim().replace(/\s+/g, " ").slice(0, 320);

  let requestedSummary: string | null = null;
  const sh = args.shadowInterpretation;
  if (sh?.ok === true) {
    const bits: string[] = [];
    if (sh.data.suggests_commitment_change) bits.push("shadow:suggests_commitment_change");
    const rs = sh.data.reasoning_short?.trim();
    if (rs) bits.push(`reasoning_short:${rs.slice(0, 160)}`);
    if (bits.length > 0) requestedSummary = bits.join(" | ").slice(0, 280);
  }

  const req =
    "Heuristic commitment-change phrasing was detected but server gated_mode is not commitment_change_handoff — no Wave4 pending-resolution was created on this inbound branch and no_state_change_taken is true. " +
    "Do NOT claim the written commitment row changed, do NOT claim a pending SMS update flow was started, and do NOT invent new commitment terms or binding bars. " +
    "Continue the coaching relationship anchored to v2_accountability facts (classifier outcome, effective ask, gated mode). " +
    "Offer one honest next coaching move or one clear clarifying question; one short SMS. If unsafe or uncertain, return should_send false.";

  return {
    heuristic_commitment_change_intent: true,
    gated_mode: args.gatedMode,
    server_decision: "not_handoff",
    current_commitment_snapshot: currentCommitmentSnapshot,
    user_message_preview: preview,
    requested_change_summary: requestedSummary,
    no_state_change_taken: true,
    required_meaning_summary: req,
    inbound_message_sid: args.messageSid,
  };
}

/** Adaptive overlay proposal consent — server already applied/declined; legacy ACK is preview only. */
export type InboundV3ContractConsentFacts = {
  consent_parse: "user_yes" | "user_no";
  latest_outbound_was_proposal: boolean;
  proposal_kind: string;
  /** Short digest for facts JSON (not full binding when long). */
  proposal_text_digest: string;
  overlay_action:
    | "activated"
    | "declined"
    | "noop_already_applied"
    | "noop_not_found"
    | "noop_state_conflict";
  rpc_result: string;
  server_state_transition_summary: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
  /** Non-speakable legacy template / prior-writer preview — metadata only. */
  legacy_contract_ack_preview: string;
  inbound_message_sid: string;
  proposal_expires_at: string | null;
};

/** Refresh session — machine/template preview is metadata only. */
export type InboundV3RefreshFacts = {
  refresh_step: string;
  expected_answer: string;
  user_answer_type: string;
  state_transition_summary: string;
  updated_identity_anchor?: string | null;
  updated_commitment_bar?: string | null;
  /** Non-speakable legacy refresh machine/template copy. */
  legacy_refresh_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
};

export type { InboundV3PendingReplacementFacts } from "@/lib/v3-inbound-pending-replacement-truth";

export type InboundV3PendingResolutionFacts = {
  resolution_type: string;
  pending_action: string;
  user_answer_type: string;
  state_transition_summary: string;
  updated_commitment_snapshot: string;
  /** Non-speakable legacy pending-resolution reply body. */
  legacy_pending_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
};

export type InboundV3MemoryConfirmationFacts = {
  pending_memory_kind: string;
  candidate_memory_fields: string;
  user_confirmation_parse: string;
  memory_applied: boolean;
  memory_declined: boolean;
  ambiguous: boolean;
  /** Non-speakable legacy fixed/refined reply preview. */
  legacy_memory_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
  /** Structured proof hint for telemetry — not copyable SMS append. */
  memory_proof_structured_hint?: string | null;
};

/** Semantic resolution + legacy writer preview only (not speakable coach voice). */
export type InboundV3OpenQuestionFacts = {
  latest_open_question: string | null;
  expected_reply_semantics: string;
  resolution_subkind: string;
  extracted_answer: string | null;
  answer_kind: string | null;
  /** Non-speakable legacy OpenAI/deterministic writer preview — metadata only. */
  old_open_question_reply_preview: string;
  deterministic_fallback_used: boolean;
  deterministic_fallback_reason: string | null;
  legacy_open_question_reply_source: "openai" | "deterministic_fallback";
  latest_outbound_preview: string | null;
};

/** Facts-only payload when central brain blocks outcome scoring (pivot path). */
export type InboundV3CentralBrainPivotFacts = {
  blocked_outcome_scoring: boolean;
  central_turn_purpose: string | null;
  confidence: number | null;
  reason: string;
  suggested_move: string;
  /** Non-speakable legacy tether preview (metadata only). */
  legacy_tether_text_preview: string;
};

/** Facts-only payload when ARC forces ambiguous-short clarification. */
export type InboundV3ArcClarificationFacts = {
  ambiguous_short_reply: boolean;
  tentative_outcome: "user_yes" | "user_no" | "user_partial";
  clarification_reason: string | null;
  context_age: {
    accountability_prompt_age_minutes: number | null;
    accountability_prompt_sent_at: string | null;
    latest_outcome_at: string | null;
  };
  latest_question: string | null;
  /** Non-speakable legacy clarification template preview (metadata only). */
  legacy_clarification_text_preview: string;
};

/** Central brain blocked blocker capture — tether preview is facts only. */
export type InboundV3CentralBrainBlockerPivotFacts = {
  blocked_blocker_capture: boolean;
  central_turn_purpose: string | null;
  confidence: number | null;
  reason: string;
  suggested_move: string;
  blocker_text: string;
  /** Non-speakable legacy tether preview (metadata only). */
  legacy_tether_text_preview: string;
};

/** Blocker capture ACK — legacy AI/template ack is facts only. */
export type InboundV3BlockerFacts = {
  blocker_text: string;
  blocker_category: string | null;
  repeated_blocker_signal: boolean;
  following_event_type: string;
  /** Minutes until blocker capture window expires, if known. */
  blocker_pending_age_minutes_remaining: number | null;
  suggested_next_move: string | null;
  /** Non-speakable legacy ack (AI or template) preview (metadata only). */
  legacy_blocker_ack_preview: string;
};

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

/** Conversation brain off + legacy deterministic SMS disabled — deterministic template is preview/metadata only. */
export type InboundV3ConversationBrainFallbackFacts = {
  conversation_brain_control_available: false;
  legacy_fallback_reason: string;
  /** Non-speakable deterministic template body — metadata only; do not quote or imitate. */
  deterministic_template_preview: string;
  classifier_result: V2InboundEventType;
  gated_event_type: string | null;
  should_write_outcome_event: boolean;
  suggested_coaching_move: string;
  current_commitment_snapshot: string;
  server_state_summary: string;
  inbound_message_sid: string;
  /** Merged into lane constraints.required_meaning_summary. */
  coaching_route_meaning_summary: string;
};

const CONVERSATION_BRAIN_UNAVAILABLE_ROUTE_MEANING =
  "Conversation brain was unavailable or disabled. Use the server facts and recent thread to write the next coaching SMS. " +
  "Do not quote or imitate the deterministic_template_preview in conversation_brain_fallback_facts. If unsure, no_send.";

export function buildConversationBrainFallbackFacts(args: {
  legacyFallbackReason: string;
  deterministicTemplateBody: string;
  classifierResult: V2InboundEventType;
  gatedEventType: string | null;
  shouldWriteOutcomeEvent: boolean;
  gatedMode: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  inboundMessageSid: string;
}): InboundV3ConversationBrainFallbackFacts {
  const raw = args.deterministicTemplateBody.trim();
  const deterministic_template_preview = raw.length > 500 ? `${raw.slice(0, 497)}...` : raw;

  const ft = args.gatedEventType;
  let suggested_coaching_move = "ask_accountability";
  if (ft === "user_yes") suggested_coaching_move = "acknowledge_completion";
  else if (ft === "user_no") suggested_coaching_move = "name_blocker";
  else if (ft === "user_partial") suggested_coaching_move = "narrow_blocker";
  else if (args.gatedMode === "clarify") suggested_coaching_move = "clarify_intent";

  const snapParts = [
    `title:${args.commitment.title?.trim().slice(0, 80) ?? ""}`,
    `behavior:${(args.commitment.behavior_statement ?? "").trim().replace(/\s+/g, " ").slice(0, 200)}`,
    `effective_ask:${args.effectiveAsk.trim().replace(/\s+/g, " ").slice(0, 200)}`,
  ];
  const current_commitment_snapshot = snapParts.join(" | ");

  const server_state_summary = [
    `gated_mode:${args.gatedMode}`,
    `writes_outcome:${args.shouldWriteOutcomeEvent}`,
    `legacy_fallback_disabled:true`,
  ].join("|");

  return {
    conversation_brain_control_available: false,
    legacy_fallback_reason: args.legacyFallbackReason.trim().slice(0, 200),
    deterministic_template_preview,
    classifier_result: args.classifierResult,
    gated_event_type: args.gatedEventType,
    should_write_outcome_event: args.shouldWriteOutcomeEvent,
    suggested_coaching_move,
    current_commitment_snapshot,
    server_state_summary,
    inbound_message_sid: args.inboundMessageSid,
    coaching_route_meaning_summary: CONVERSATION_BRAIN_UNAVAILABLE_ROUTE_MEANING,
  };
}

export function slimConversationBrainFallbackFactsForTelemetry(
  f: InboundV3ConversationBrainFallbackFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    conversation_brain_control_available: f.conversation_brain_control_available,
    legacy_fallback_reason: f.legacy_fallback_reason,
    classifier_result: f.classifier_result,
    gated_event_type: f.gated_event_type,
    should_write_outcome_event: f.should_write_outcome_event,
    suggested_coaching_move: f.suggested_coaching_move,
    deterministic_template_preview_len: f.deterministic_template_preview.length,
    current_commitment_snapshot_len: f.current_commitment_snapshot.length,
    server_state_summary: f.server_state_summary,
    inbound_message_sid: f.inbound_message_sid,
  };
}

export type InboundV3RelationshipFacts = {
  route_purpose: InboundV3RoutePurpose;
  branch_name?: string | null;
  branch_migrated_to_lane?: boolean;
  central_brain_pivot_facts?: InboundV3CentralBrainPivotFacts | null;
  arc_clarification_facts?: InboundV3ArcClarificationFacts | null;
  central_brain_blocker_pivot_facts?: InboundV3CentralBrainBlockerPivotFacts | null;
  blocker_facts?: InboundV3BlockerFacts | null;
  open_question_facts?: InboundV3OpenQuestionFacts | null;
  refresh_facts?: InboundV3RefreshFacts | null;
  pending_resolution_facts?: InboundV3PendingResolutionFacts | null;
  pending_replacement_facts?: InboundV3PendingReplacementFacts | null;
  season_transition_facts?: InboundV3SeasonTransitionFacts | null;
  memory_confirmation_facts?: InboundV3MemoryConfirmationFacts | null;
  contract_consent_facts?: InboundV3ContractConsentFacts | null;
  adaptive_consent_clarification_facts?: InboundV3AdaptiveConsentClarificationFacts | null;
  commitment_change_facts?: InboundV3CommitmentChangeFacts | null;
  commitment_change_context_facts?: InboundV3CommitmentChangeContextFacts | null;
  comms_preferences_facts?: InboundV3CommsPreferencesFacts | null;
  conversation_brain_fallback_facts?: InboundV3ConversationBrainFallbackFacts | null;
  /** Read-only Victory Room background (season label + Pat Read); non-speakable unless naturally relevant. */
  victory_background?: V3VictoryBackgroundFacts | null;
  thread_freshness?: ThreadFreshnessFacts | null;
  temporal_contract?: TemporalContractV1 | null;
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
    planned_interruption_active?: boolean;
    planned_interruption_reason_category?: string | null;
    planned_interruption_resume_hint?: string | null;
  };
  thread: {
    latest_inbound_raw: string;
    /** After rapid-split coalescing when applied upstream; else same as raw. */
    coalesced_inbound_text: string;
    suppressed_message_sids: string[];
    recent_transcript_lines: string[];
    latest_outbound_coach_sms: string | null;
    latest_open_question: string | null;
    latest_answer_after_open_question: string | null;
    expected_reply_semantics: string | null;
    memory_authority: {
      open_question_source: "projection" | "runtime_guess" | "north_star" | "none";
      answer_source: "projection" | "runtime_guess" | "none";
      projection_used: boolean;
    };
    do_not_repeat_hints: string[];
    rejected_time_candidates: string[];
    unavailable_windows: string[];
    current_inbound_is_already_told_you_correction: boolean;
    current_inbound_is_short_acknowledgement: boolean;
    most_recent_substantive_prior_user_message: string | null;
    most_recent_coach_question: string | null;
    memory_correction_should_use_prior_user_answer: boolean;
    short_ack_should_not_reask_question: boolean;
    memory_packet?: {
      recent_exact_thread_text: string;
      recent_exact_thread_72h: RecentExactThread72hResult;
      relationship_memory_7d: RelationshipMemory7dResult;
      relationship_memory_30d: RelationshipMemory30dResult;
      recent_exact_message_count: number;
      last_outbound_full_body: string | null;
      last_inbound_full_body: string | null;
      last_substantive_user_message: string | null;
      last_substantive_coach_message: string | null;
      last_5_coach_questions: string[];
      last_5_user_answers: string[];
      latest_open_question: string | null;
      latest_answer_after_open_question: string | null;
      open_question_pending: boolean;
      open_question_source: "projection" | "runtime_guess" | "none";
      answer_source: "projection" | "runtime_guess" | "none";
      projection_used: boolean;
      latest_open_question_guess: string | null;
      latest_answer_after_open_question_guess: string | null;
      do_not_repeat_phrases: string[];
      memory_priority_rules: string[];
    };
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
    pattern_signal_confidence?: string | null;
    pattern_canonical?: string | null;
    pattern_mention_allowed?: boolean;
    pattern_internal_hint?: string | null;
    goal_adjustment_move?: string | null;
    goal_adjustment_confidence?: string | null;
    goal_adjustment_mention_allowed?: boolean;
    goal_adjustment_internal_hint?: string | null;
    goal_adjustment_requires_confirmation?: boolean;
    goal_adjustment_compatible_flow?: string | null;
    adjustment_proposal_allowed_by_evidence?: boolean;
    single_miss_recovery_required?: boolean;
    adjustment_evidence_reason?: string | null;
    proof_callout_hint?: InboundV3ProofCalloutHint | null;
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
  relationship_exit?: InboundV3RelationshipExitFacts | null;
  identity_edit?: InboundV3IdentityEditFacts | null;
  memory_repeat_escalation?: InboundPriorMemoryRepeatNoSendContext | null;
  inbound_meaning: InboundMeaningFacts;
  /** Server-reconciled OpenAI turn understanding (advisory; persistence still server-owned). */
  turn_understanding?: ReconciledTurnUnderstanding | null;
  suggested_coaching_move: string;
  /** How suggested_coaching_move was chosen (telemetry). */
  coaching_move_source?: InboundCoachingMoveSource;
  /** P0 Step C — server-owned miss/adjustment policy for writer + final guard. */
  miss_adjustment_policy?: MissAdjustmentPolicyResult;
  /** True when legacy fallback move existed but authoritative TU owned the move. */
  conversation_brain_fallback_suppressed_by_turn_understanding?: boolean;
  constraints: {
    max_chars: number;
    one_sms: true;
    no_generic_motivation: true;
    no_quoted_or_truncated_echo_of_inbound: true;
    if_unsafe_return_no_send: true;
    /** Substrings that must NOT appear in body (e.g. rejected times). */
    forbidden_substrings?: string[];
    /** Each substring MUST appear verbatim in body when non-empty (transactional accuracy). */
    required_verbatim_substrings?: string[];
    /** Coach must satisfy this meaning without contradicting server-owned state. */
    required_meaning_summary?: string | null;
  };
};

export type InboundCoachingMoveSource =
  | "turn_understanding"
  | "conversation_brain_fallback"
  | "hard_route"
  | "open_question"
  | "deterministic"
  | "thread_correction";

export type DerivedInboundCoachingMove = {
  move: string;
  coaching_move_source: InboundCoachingMoveSource;
  conversation_brain_fallback_suppressed_by_turn_understanding?: boolean;
};

export type InboundV3RelationshipLaneInput = {
  facts: InboundV3RelationshipFacts;
  telemetry_fact_sources: string[];
  /** Authoritative server row for row-backed active_pending_state (read-only context). */
  commitmentRow?: ActiveV2CommitmentRow | null;
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
    branch_migrated: f.branch_migrated_to_lane === true,
    branch_name: f.branch_migrated_to_lane === true ? f.branch_name ?? null : null,
    pivot_facts: f.central_brain_pivot_facts != null,
    blocker_pivot_facts: f.central_brain_blocker_pivot_facts != null,
    blocker_ack_facts: f.blocker_facts != null,
    arc_clarify_facts: f.arc_clarification_facts != null,
    open_question_facts: f.open_question_facts != null,
    refresh_facts: f.refresh_facts != null,
    pending_resolution_facts: f.pending_resolution_facts != null,
    pending_replacement_facts: f.pending_replacement_facts != null,
    memory_confirmation_facts: f.memory_confirmation_facts != null,
    contract_consent_facts: f.contract_consent_facts != null,
    adaptive_consent_clarification_facts: f.adaptive_consent_clarification_facts != null,
    commitment_change_facts: f.commitment_change_facts != null,
    commitment_change_context_facts: f.commitment_change_context_facts != null,
    conversation_brain_fallback_facts: f.conversation_brain_fallback_facts != null,
    gated_mode: f.v2_accountability.gated_mode,
    final_event_type: f.v2_accountability.final_event_type,
    classifier: f.v2_accountability.deterministic_classifier_event,
    suggested_move: f.suggested_coaching_move,
    coaching_move_source: f.coaching_move_source ?? null,
    conversation_brain_fallback_suppressed_by_turn_understanding:
      f.conversation_brain_fallback_suppressed_by_turn_understanding ?? null,
    inbound_meaning: {
      relationship_meaning: f.inbound_meaning.relationship_meaning,
      temporal_scope: f.inbound_meaning.temporal_scope,
      persistence_decision: f.inbound_meaning.persistence_decision,
      sms_response_intent: f.inbound_meaning.sms_response_intent,
    },
    turn_understanding: f.turn_understanding
      ? {
          reconciled_response_intent: f.turn_understanding.reconciled_response_intent,
          last_ask_satisfied: f.turn_understanding.last_ask_satisfied,
          interpreter_failed: Boolean(f.turn_understanding.interpreter_failed_reason),
        }
      : null,
    proof: f.v2_accountability.proof_signal,
    miss: f.v2_accountability.miss_signal,
    wave11_pending: f.legacy_suggestions.wave11_memory_confirmation_pending,
    conversation_brain_on: f.legacy_suggestions.conversation_brain?.enabled ?? false,
    central_shadow: f.legacy_suggestions.central_brain?.shadow_stored ?? false,
    already_told_you: f.thread.current_inbound_is_already_told_you_correction,
    short_ack: f.thread.current_inbound_is_short_acknowledgement,
    prior_user_answer_len: f.thread.most_recent_substantive_prior_user_message?.length ?? 0,
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

export function slimCentralBrainPivotFactsForTelemetry(
  f: InboundV3CentralBrainPivotFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    blocked_outcome_scoring: f.blocked_outcome_scoring,
    central_turn_purpose: f.central_turn_purpose,
    confidence: f.confidence,
    reason: f.reason,
    suggested_move: f.suggested_move,
    legacy_tether_text_preview_len: f.legacy_tether_text_preview.length,
  };
}

export function slimArcClarificationFactsForTelemetry(
  f: InboundV3ArcClarificationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    ambiguous_short_reply: f.ambiguous_short_reply,
    tentative_outcome: f.tentative_outcome,
    clarification_reason: f.clarification_reason,
    context_age: f.context_age,
    latest_question_len: f.latest_question != null ? f.latest_question.length : 0,
    legacy_clarification_text_preview_len: f.legacy_clarification_text_preview.length,
  };
}

export function slimCentralBrainBlockerPivotFactsForTelemetry(
  f: InboundV3CentralBrainBlockerPivotFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    blocked_blocker_capture: f.blocked_blocker_capture,
    central_turn_purpose: f.central_turn_purpose,
    confidence: f.confidence,
    reason: f.reason,
    suggested_move: f.suggested_move,
    blocker_text_len: f.blocker_text.length,
    legacy_tether_text_preview_len: f.legacy_tether_text_preview.length,
  };
}

export function slimBlockerFactsForTelemetry(f: InboundV3BlockerFacts | null | undefined): Record<string, unknown> | null {
  if (!f) return null;
  return {
    following_event_type: f.following_event_type,
    blocker_category: f.blocker_category,
    repeated_blocker_signal: f.repeated_blocker_signal,
    blocker_pending_age_minutes_remaining: f.blocker_pending_age_minutes_remaining,
    blocker_text_len: f.blocker_text.length,
    legacy_blocker_ack_preview_len: f.legacy_blocker_ack_preview.length,
    has_suggested_next_move: f.suggested_next_move != null && f.suggested_next_move.trim().length > 0,
  };
}

export function slimOpenQuestionFactsForTelemetry(
  f: InboundV3OpenQuestionFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    resolution_subkind: f.resolution_subkind,
    answer_kind: f.answer_kind,
    extracted_answer_len: f.extracted_answer?.trim().length ?? 0,
    old_open_question_reply_preview_len: f.old_open_question_reply_preview.length,
    deterministic_fallback_used: f.deterministic_fallback_used,
    legacy_open_question_reply_source: f.legacy_open_question_reply_source,
    latest_outbound_preview_len: f.latest_outbound_preview?.trim().length ?? 0,
  };
}

export function slimRefreshFactsForTelemetry(f: InboundV3RefreshFacts | null | undefined): Record<string, unknown> | null {
  if (!f) return null;
  return {
    refresh_step: f.refresh_step,
    user_answer_type: f.user_answer_type,
    expected_answer_len: f.expected_answer?.length ?? 0,
    legacy_refresh_reply_preview_len: f.legacy_refresh_reply_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimPendingResolutionFactsForTelemetry(
  f: InboundV3PendingResolutionFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    resolution_type: f.resolution_type,
    pending_action: f.pending_action,
    user_answer_type: f.user_answer_type,
    legacy_pending_reply_preview_len: f.legacy_pending_reply_preview.length,
    updated_commitment_snapshot_len: f.updated_commitment_snapshot.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimMemoryConfirmationFactsForTelemetry(
  f: InboundV3MemoryConfirmationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    pending_memory_kind: f.pending_memory_kind,
    user_confirmation_parse: f.user_confirmation_parse,
    memory_applied: f.memory_applied,
    memory_declined: f.memory_declined,
    ambiguous: f.ambiguous,
    legacy_memory_reply_preview_len: f.legacy_memory_reply_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    has_proof_hint: Boolean(f.memory_proof_structured_hint?.trim()),
  };
}

export function slimContractConsentFactsForTelemetry(
  f: InboundV3ContractConsentFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    consent_parse: f.consent_parse,
    proposal_kind: f.proposal_kind,
    overlay_action: f.overlay_action,
    rpc_result: f.rpc_result,
    proposal_text_digest_len: f.proposal_text_digest.length,
    legacy_contract_ack_preview_len: f.legacy_contract_ack_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    latest_outbound_was_proposal: f.latest_outbound_was_proposal,
  };
}

export function slimAdaptiveConsentClarificationFactsForTelemetry(
  f: InboundV3AdaptiveConsentClarificationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    pending_proposal_valid: f.pending_proposal_valid,
    latest_outbound_was_proposal: f.latest_outbound_was_proposal,
    proposal_kind: f.proposal_kind,
    inbound_parse: f.inbound_parse,
    server_action_taken: f.server_action_taken,
    state_remains_pending: f.state_remains_pending,
    proposal_text_digest_len: f.proposal_text_digest.length,
    legacy_clarification_preview_len: f.legacy_clarification_preview.length,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimCommitmentChangeFactsForTelemetry(
  f: InboundV3CommitmentChangeFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    detected_intent_type: f.detected_intent_type,
    pending_resolution_created: f.pending_resolution_created,
    pending_resolution_type: f.pending_resolution_type,
    pending_resolution_skip_reason: f.pending_resolution_skip_reason,
    pending_resolution_apply_exception: f.pending_resolution_apply_exception,
    existing_pending_resolution: f.existing_pending_resolution,
    server_state_transition_summary: f.server_state_transition_summary,
    legacy_preview_len: f.legacy_commitment_change_reply_preview.length,
    append_note_preview_len: f.append_note_preview?.length ?? 0,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    inbound_message_sid: f.inbound_message_sid,
  };
}

export function slimCommitmentChangeContextFactsForTelemetry(
  f: InboundV3CommitmentChangeContextFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    heuristic_commitment_change_intent: f.heuristic_commitment_change_intent,
    gated_mode: f.gated_mode,
    server_decision: f.server_decision,
    no_state_change_taken: f.no_state_change_taken,
    user_message_preview_len: f.user_message_preview.length,
    requested_change_summary_len: f.requested_change_summary?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    inbound_message_sid: f.inbound_message_sid,
  };
}

/** Authoritative TU owns coaching move when satisfied/stale/DNR or mapped response intent exists. */
export function turnUnderstandingShouldSourceCoachingMove(
  tu: ReconciledTurnUnderstanding | null | undefined
): boolean {
  if (!tu || !isTurnUnderstandingAuthoritative(tu)) return false;
  if (tu.last_ask_satisfied === "yes") return true;
  if (tu.stale_ask_risk) return true;
  if (tu.reconciled_do_not_repeat_asks.length > 0) return true;
  return coachingMoveFromReconciledResponseIntent(tu.reconciled_response_intent) != null;
}

export function deriveInboundCoachingMoveForFacts(
  f: InboundV3RelationshipFacts
): DerivedInboundCoachingMove {
  const fallbackFacts = f.conversation_brain_fallback_facts;
  const tu = f.turn_understanding;

  if (
    f.pending_replacement_facts?.pending_resolution_active === true &&
    f.pending_replacement_facts.pending_resolution_applied !== true
  ) {
    return { move: "coach_pending_commitment_replace_candidate", coaching_move_source: "hard_route" };
  }
  if (f.central_brain_pivot_facts) {
    const m = f.central_brain_pivot_facts.suggested_move?.trim();
    return {
      move: m && m.length > 0 ? m : "pivot_respond_humanely",
      coaching_move_source: "hard_route",
    };
  }
  if (f.central_brain_blocker_pivot_facts) {
    const m = f.central_brain_blocker_pivot_facts.suggested_move?.trim();
    return {
      move: m && m.length > 0 ? m : "blocker_pivot_respond_humanely",
      coaching_move_source: "hard_route",
    };
  }
  if (f.arc_clarification_facts) {
    return { move: "clarify_ambiguous_short_natural_sms", coaching_move_source: "hard_route" };
  }
  if (f.blocker_facts) {
    return { move: "acknowledge_blocker_capture", coaching_move_source: "hard_route" };
  }
  if (f.adaptive_consent_clarification_facts) {
    return {
      move: "ask_clear_yes_or_no_for_pending_adaptive_proposal",
      coaching_move_source: "hard_route",
    };
  }
  if (f.commitment_change_context_facts) {
    return {
      move: "respond_commitment_change_context_without_pending_resolution",
      coaching_move_source: "hard_route",
    };
  }
  if (f.identity_edit) {
    if (f.identity_edit.goal_confusion_risk) {
      return { move: "separate_identity_from_goal_clarify", coaching_move_source: "hard_route" };
    }
    if (f.identity_edit.discouragement_risk) {
      return { move: "protect_identity_after_bad_day", coaching_move_source: "hard_route" };
    }
    if (f.identity_edit.should_invite_victory_room_review) {
      return {
        move: "clarify_identity_optional_victory_room_review",
        coaching_move_source: "hard_route",
      };
    }
    return { move: "clarify_identity_integrity", coaching_move_source: "hard_route" };
  }
  if (f.commitment_change_facts) {
    return {
      move: "commitment_change_handoff_respond_with_server_owned_next_steps",
      coaching_move_source: "hard_route",
    };
  }
  if (f.contract_consent_facts) {
    if (f.route_purpose === "adaptive_proposal_consent_decline") {
      return { move: "acknowledge_adaptive_overlay_declined", coaching_move_source: "hard_route" };
    }
    if (f.route_purpose === "adaptive_proposal_consent_noop_ack") {
      return { move: "acknowledge_adaptive_proposal_noop", coaching_move_source: "hard_route" };
    }
    return { move: "acknowledge_adaptive_overlay_accepted", coaching_move_source: "hard_route" };
  }
  if (f.refresh_facts) {
    return { move: "continue_refresh_coach_sms", coaching_move_source: "hard_route" };
  }
  if (f.pending_resolution_facts) {
    return { move: "continue_pending_resolution_coach_sms", coaching_move_source: "hard_route" };
  }
  if (f.memory_confirmation_facts) {
    if (f.route_purpose === "memory_decline") {
      return { move: "acknowledge_memory_declined", coaching_move_source: "hard_route" };
    }
    if (f.route_purpose === "memory_clarification") {
      return { move: "clarify_memory_confirmation_reply", coaching_move_source: "hard_route" };
    }
    return { move: "acknowledge_memory_update_outcome", coaching_move_source: "hard_route" };
  }

  if (turnUnderstandingShouldSourceCoachingMove(tu)) {
    const reconciledMove = coachingMoveFromReconciledResponseIntent(tu!.reconciled_response_intent);
    const move = reconciledMove ?? "clarify_intent";
    return {
      move,
      coaching_move_source: "turn_understanding",
      ...(fallbackFacts
        ? { conversation_brain_fallback_suppressed_by_turn_understanding: true }
        : {}),
    };
  }

  if (fallbackFacts) {
    return {
      move: fallbackFacts.suggested_coaching_move,
      coaching_move_source: "conversation_brain_fallback",
    };
  }

  if (
    f.open_question_facts &&
    !reconciledTurnUnderstandingOverridesOpenQuestionFacts(f.turn_understanding)
  ) {
    return {
      move: "respond_to_open_question_answer_natural",
      coaching_move_source: "open_question",
    };
  }
  if (f.thread.current_inbound_is_already_told_you_correction) {
    return {
      move: "use_recent_answer_after_correction",
      coaching_move_source: "thread_correction",
    };
  }
  if (f.thread.short_ack_should_not_reask_question) {
    return {
      move: "acknowledge_prior_answer_without_reasking",
      coaching_move_source: "thread_correction",
    };
  }
  const meaningMove = coachingMoveFromSmsResponseIntent(f.inbound_meaning.sms_response_intent);
  if (meaningMove) {
    return { move: meaningMove, coaching_move_source: "deterministic" };
  }
  const ft = f.v2_accountability.final_event_type;
  if (ft === "user_yes") {
    return { move: "acknowledge_completion", coaching_move_source: "deterministic" };
  }
  if (ft === "user_no") {
    return { move: "name_blocker", coaching_move_source: "deterministic" };
  }
  if (ft === "user_partial") {
    return { move: "narrow_blocker", coaching_move_source: "deterministic" };
  }
  if (f.v2_accountability.gated_mode === "clarify") {
    return { move: "clarify_intent", coaching_move_source: "deterministic" };
  }
  return { move: "ask_accountability", coaching_move_source: "deterministic" };
}

export function deriveSuggestedCoachingMoveForInboundFacts(f: InboundV3RelationshipFacts): string {
  return deriveInboundCoachingMoveForFacts(f).move;
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

/** Returns first required substring missing from body, or null if all present. */
function validateRequiredVerbatimSubstrings(body: string, required: string[] | undefined): string | null {
  if (!required?.length) return null;
  for (const sub of required) {
    const t = sub.trim();
    if (!t) continue;
    if (!body.includes(t)) return t;
  }
  return null;
}

export type RequiredVerbatimAssertionStage = "lane" | "post_north_star" | "post_final_voice_gate";

/**
 * Multi-stage binding survival check for contract consent (and similar).
 * Empty required list → ok.
 */
export function assertRequiredVerbatimSubstringsPresent(
  stage: RequiredVerbatimAssertionStage,
  body: string,
  requiredSubstrings: string[] | undefined | null
): { ok: boolean; missing: string[]; stage: RequiredVerbatimAssertionStage } {
  const missing: string[] = [];
  if (requiredSubstrings?.length) {
    for (const sub of requiredSubstrings) {
      const t = sub.trim();
      if (!t) continue;
      if (!body.includes(t)) missing.push(t);
    }
  }
  return { ok: missing.length === 0, missing, stage };
}

/** YES-path binding substring — exact characters from proposal head (≤28) for lane verbatim match. */
export function contractConsentYesBindingVerbatimSubstring(proposalText: string): string | null {
  const t = proposalText.trim();
  if (!t) return null;
  if (t.length > 28) return t.slice(0, 28);
  return t;
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

function buildRoutePurposeAux(f: InboundV3RelationshipFacts): string {
  const rp = f.route_purpose;
  if (rp === "central_brain_pivot") {
    return `
ROUTE (central_brain_pivot): Outcome scoring was blocked by central brain for this turn. Use central_brain_pivot_facts for central_turn_purpose, confidence, reason, and suggested_move. The field legacy_tether_text_preview is NON-SPEAKABLE legacy machine/coached copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one fresh humane SMS as the coach for this pivot.`;
  }
  if (rp === "central_brain_blocker_pivot") {
    return `
ROUTE (central_brain_blocker_pivot): Blocker capture was blocked by central brain for this turn. Use central_brain_blocker_pivot_facts (central_turn_purpose, confidence, reason, suggested_move, blocker_text). The field legacy_tether_text_preview is NON-SPEAKABLE legacy machine/coached copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one fresh humane SMS as the coach for this pivot.`;
  }
  if (rp === "blocker_capture_ack") {
    return `
ROUTE (blocker_capture_ack): The user submitted blocker text after a miss; server already owns state. Use blocker_facts (blocker_text, following_event_type, repeated_blocker_signal, blocker_pending_age_minutes_remaining, suggested_next_move). The field legacy_blocker_ack_preview is NON-SPEAKABLE legacy AI/template copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one short SMS acknowledging the blocker and holding the standard, as the coach.`;
  }
  if (rp === "arc_clarify_ambiguous_short") {
    return `
ROUTE (arc_clarify_ambiguous_short): The user's latest reply is ambiguous relative to accountability context. Use arc_clarification_facts (tentative_outcome, clarification_reason, context_age, latest_question). The field legacy_clarification_text_preview is NON-SPEAKABLE legacy template copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one natural clarifying SMS as the coach.`;
  }
  if (rp === "open_question_answer") {
    return `
ROUTE (open_question_answer): The user is answering the coach's latest question in-thread. Use open_question_facts (latest_open_question, expected_reply_semantics, resolution_subkind, extracted_answer, answer_kind) plus thread and commitment facts. The field old_open_question_reply_preview is NON-SPEAKABLE legacy machine copy from an old writer path — do not quote it, imitate it, paste it, or treat it as your voice. Write the NEXT SMS as the coach responding naturally to the user's answer.`;
  }
  if (rp === "refresh" || rp.startsWith("refresh_")) {
    return `
ROUTE (${rp}): Guided refresh-session SMS. Server already applied refresh_state / transitions in facts — do NOT invent, undo, or alter commitments or identity from prose. Use refresh_facts (refresh_step, user_answer_type, expected_answer, state_transition_summary, updated_identity_anchor, updated_commitment_bar). legacy_refresh_reply_preview is NON-SPEAKABLE machine/template copy — do not quote, imitate, or paste it. If constraints.required_verbatim_substrings is non-empty, include EVERY listed substring exactly in body. If constraints.required_meaning_summary is set, satisfy it accurately. Write ONE SMS as the coach continuing the thread.`;
  }
  if (rp === "pending_resolution") {
    return (
      `
ROUTE (pending_resolution): SMS pending guided-resolution turn. Use pending_resolution_facts (resolution_type, pending_action, user_answer_type, state_transition_summary, updated_commitment_snapshot), pending_replacement_facts, and season_transition_facts when present. legacy_pending_reply_preview is NON-SPEAKABLE machine copy — do not quote, imitate, or paste it. If pending_replacement_facts.pending_resolution_applied is false: the pending candidate bar is user-facing truth — do NOT coach canonical_behavior_statement as current; do NOT say goal/commitment updated/changed/locked in. If pending_resolution_applied is true: canonical commitment was updated — you may acknowledge honestly. Honor required_verbatim_substrings / required_meaning_summary. One SMS.` +
      buildSeasonTransitionRouteAux(f)
    );
  }
  if (rp === "memory_confirmation" || rp === "memory_decline" || rp === "memory_clarification") {
    return `
ROUTE (${rp}): Wave 11 memory confirmation / decline / ambiguity. Server already decided memory_applied / memory_declined / ambiguous flags — do NOT contradict them or claim updates that did not occur. Use memory_confirmation_facts (pending_memory_kind, candidate_memory_fields, user_confirmation_parse, flags). legacy_memory_reply_preview is NON-SPEAKABLE fixed/refined copy — do not quote, imitate, or paste it. memory_proof_structured_hint is structured telemetry only — do not paste it verbatim. Honor required_verbatim_substrings / required_meaning_summary when present. Write ONE SMS as the coach.`;
  }
  if (rp === "adaptive_proposal_consent_clarification") {
    return `
ROUTE (adaptive_proposal_consent_clarification): A pending adaptive overlay proposal is on the table; the user has NOT clearly accepted or declined (server_action_taken none; state_remains_pending true). Use adaptive_consent_clarification_facts (inbound_parse, proposal_kind, proposal_text_digest, latest_outbound_was_proposal). legacy_clarification_preview is NON-SPEAKABLE stub copy — do not quote, imitate, or paste it. Do NOT treat this as today's accountability check outcome. Do NOT imply the overlay was accepted or declined. Ask for an explicit YES or NO about the proposal only. Honor constraints.required_meaning_summary. One short SMS; if unsafe or uncertain, return should_send false.`;
  }
  if (rp === "commitment_change_handoff") {
    return `
ROUTE (commitment_change_handoff): User signaled a commitment change without a clear accountability score for today. Server already ran pending-resolution logic — use commitment_change_facts only (pending_resolution_created, pending_resolution_skip_reason, existing_pending_resolution, server_state_transition_summary, candidate previews). Do NOT claim the written commitment row already changed unless facts explicitly say so (they do not here). pending_resolution_created true means an SMS update flow was started, not that the commitment is finalized. legacy_commitment_change_reply_preview and append_note_preview are NON-SPEAKABLE metadata — do not quote, imitate, or paste them. Honor constraints.required_verbatim_substrings and constraints.required_meaning_summary when present. One short SMS; if unsafe or uncertain, return should_send false.`;
  }
  if (rp === "relationship_exit_integrity") {
    return `
ROUTE (relationship_exit_integrity): User signaled exit, frustration, billing concern, or soft opt-out of texts — NOT today's accountability completion. Use relationship_exit facts (category, suggested_next_moves, flags). v2_accountability.should_write_outcome_event is false — do NOT score or congratulate. Write ONE humane SMS as the coach.`;
  }
  if (rp === "identity_edit_integrity") {
    return `
ROUTE (identity_edit_integrity): User raised identity-level language — NOT today's accountability completion. Use identity_edit facts only (category, flags, suggested_next_moves, current_identity_snapshot). Server did NOT update identity or goal (no_identity_mutation true; should_not_claim_identity_updated true; should_not_change_goal true). Do NOT claim identity or goal was updated. Do NOT use Reply YES to confirm. Victory Room review is optional only when should_invite_victory_room_review is true — never a mandatory redirect. One short humane SMS.`;
  }
  if (rp === "commitment_change_context") {
    return `
ROUTE (commitment_change_context): Inbound matched heuristic commitment-change phrasing but gated_mode is NOT commitment_change_handoff — no Wave4 pending-resolution was started on this branch (no_state_change_taken true). Use commitment_change_context_facts only. Do NOT claim the commitment row changed, do NOT claim a pending SMS update was created, do NOT invent new commitment terms. Anchor to v2_accountability (today's classifier path, effective ask). One short coaching SMS or no_send.`;
  }
  if (rp === "conversation_brain_unavailable") {
    return `
ROUTE (conversation_brain_unavailable): Conversation brain was unavailable or disabled on this inbound. Server owns accountability state in v2_accountability and thread facts. Use conversation_brain_fallback_facts for legacy context only: deterministic_template_preview is NON-SPEAKABLE metadata — do not quote, imitate, paste, or treat it as your voice. Honor constraints.required_meaning_summary. Write the NEXT coaching SMS from facts and thread; if unsafe or uncertain, return should_send false.`;
  }
  if (
    rp === "adaptive_proposal_consent_accept" ||
    rp === "adaptive_proposal_consent_decline" ||
    rp === "adaptive_proposal_consent_noop_ack"
  ) {
    return `
ROUTE (${rp}): Adaptive overlay proposal consent. Server already decided overlay_action / rpc_result — do NOT invent YES/NO, do NOT activate/decline overlays from prose, do NOT invent contract terms. Use contract_consent_facts (consent_parse, overlay_action, proposal_kind, proposal_text_digest, server_state_transition_summary, inbound_message_sid). legacy_contract_ack_preview is NON-SPEAKABLE legacy template preview — do not quote, imitate, or paste it. If constraints.required_verbatim_substrings is non-empty, include EVERY substring exactly. If constraints.required_meaning_summary is set, satisfy it without contradicting server flags. One short SMS.`;
  }
  const commsAux = buildCommsPreferencesRouteAux(f);
  const pendingAux = buildPendingReplacementRouteAux(f);
  return commsAux + pendingAux + buildSeasonTransitionRouteAux(f) + buildThreadMemoryCorrectionRouteAux(f);
}

/** Human-language coaching guidance for season_transition_facts (V3-owned final wording). */
export function buildSeasonTransitionRouteAux(f: InboundV3RelationshipFacts): string {
  const st = f.season_transition_facts;
  if (!st) return "";

  const chapterChanged = st.chapter_changed === true || st.user_facing_transition === "new_chapter";
  const sameChapterBarRaised =
    !chapterChanged &&
    (st.user_facing_transition === "same_chapter" || st.bar_raised_in_same_chapter === true);

  let transitionGuidance = "";
  if (chapterChanged) {
    transitionGuidance = `
- chapter_changed is true / user_facing_transition is new_chapter: you MAY use simple human language like "new chapter" or "new season" when it fits naturally.
- You may reference old_season_name or new_season_name when helpful — never IDs or database terms.
- Do not overexplain season mechanics.`;
  } else if (sameChapterBarRaised) {
    transitionGuidance = `
- user_facing_transition is same_chapter / bar_raised_in_same_chapter is true: frame as same season, same chapter, or stronger standard — NOT a new chapter or new season.
- Good examples (guidance only — vary naturally): "Same chapter, stronger standard." / "We kept the focus and raised the bar." / "I'll hold you to the sharper version."
- Do NOT say "new chapter," "new season," "season closed," or "chapter closed."`;
  } else {
    transitionGuidance = `
- season_transition_facts present but no chapter change and no same-chapter bar raise signaled: do not claim any season or chapter change. Keep the reply simple and human.`;
  }

  return `
SEASON_TRANSITION (season_transition_facts — coaching context only):
Use season_transition_facts for honest coaching tone. Do NOT expose internal labels, JSON field names, enums, UUIDs, or engineering terms.
Never say: same_season_sync, season_transition_applied, same_season_goal_snapshot_synced, snapshot, sync, pending, candidate, RPC, mutation, database, route, payload, classifier, mode, commitment_id, or any UUID.
${transitionGuidance}`;
}

function buildCommsPreferencesRouteAux(f: InboundV3RelationshipFacts): string {
  const cp = f.comms_preferences_facts;
  if (!cp) return "";
  return `
COMMS_PREFERENCES (Slice C — server-owned proactive SMS timing/cadence/pause):
Use comms_preferences_facts. ${cp.required_meaning_summary}
Do not claim texts are paused unless preference_write_ok is true AND pause_active is true.
Do not claim cadence or send timing changed unless preference_write_ok is true and the user asked for that change on this turn.
If needs_cadence_clarification is true, ask one natural clarifying question (fewer texts vs pause until a date) — no menu, no "Reply YES to confirm."
STOP/HELP/START remain Twilio compliance outside this lane.`;
}

function buildPendingReplacementRouteAux(f: InboundV3RelationshipFacts): string {
  const pr = f.pending_replacement_facts;
  if (!pr?.pending_resolution_active) return "";
  return `
PENDING_COMMITMENT_REPLACE_TRUTH: pending_replacement_facts.pending_candidate_behavior_statement is the user-facing daily bar while pending_resolution_applied is false. canonical_behavior_statement is background only — do not coach it as the active bar. Do not say goal/commitment updated/changed/locked in/applied unless pending_resolution_applied is true. If confirmation is needed, ask naturally about the candidate bar (e.g. walking 10,000 steps), not the old commitment.`;
}

const INBOUND_THREAD_FRESHNESS_EXCLUDED_ROUTE_PURPOSES = new Set<InboundV3RoutePurpose>([
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
  "commitment_change_handoff",
  "identity_edit_integrity",
  "pending_resolution",
  "memory_confirmation",
  "memory_decline",
  "memory_clarification",
  "refresh",
  "refresh_identity",
  "refresh_commitment",
  "refresh_confirmation",
  "refresh_clarification",
  "relationship_exit_integrity",
]);

export function shouldRunInboundThreadFreshnessGuard(facts: InboundV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (facts.contract_consent_facts != null) return false;
  return !INBOUND_THREAD_FRESHNESS_EXCLUDED_ROUTE_PURPOSES.has(facts.route_purpose);
}

const INBOUND_LANE_REPAIR_EXCLUDED_ROUTE_PURPOSES = new Set<InboundV3RoutePurpose>([
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
  "commitment_change_handoff",
  "identity_edit_integrity",
  "pending_resolution",
  "memory_confirmation",
  "memory_decline",
  "memory_clarification",
  "refresh",
  "refresh_identity",
  "refresh_commitment",
  "refresh_confirmation",
  "refresh_clarification",
]);

function inboundLanePostValidateRepairExcluded(facts: InboundV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return true;
  return INBOUND_LANE_REPAIR_EXCLUDED_ROUTE_PURPOSES.has(facts.route_purpose);
}

function buildInboundPraisePolicyArgs(
  body: string,
  facts: InboundV3RelationshipFacts
): SmsPraisePolicyEvaluateArgs {
  const priorOutcome =
    facts.v2_accountability.final_event_type === "user_yes" ||
    facts.v2_accountability.deterministic_classifier_event === "user_yes" ||
    facts.v2_accountability.today_completed
      ? "user_yes"
      : null;
  return buildSmsPraisePolicyArgsFromInboundFacts({
    body,
    routePurpose: facts.route_purpose,
    inbound_meaning: facts.inbound_meaning,
    commitment: facts.commitment,
    thread: facts.thread,
    prior_outcome: priorOutcome,
    proof_or_milestone_signal: facts.legacy_suggestions.accountability_proof_hint,
  });
}

function evaluateInboundVoiceWithPraisePolicy(body: string, facts: InboundV3RelationshipFacts) {
  return evaluateRelationshipVoiceWithPraisePolicy(body, {
    praisePolicy: buildInboundPraisePolicyArgs(body, facts),
  });
}

type InboundPostRepairValidation =
  | { ok: true }
  | {
      ok: false;
      noSendReason: string;
      laneStage: string;
      safetySuffix?: string;
      extraMeta: Record<string, unknown>;
    };

/** Re-run inbound-specific gates on a candidate body (e.g. after lane repair). */
function validateInboundLaneCandidateBody(
  body: string,
  args: InboundV3RelationshipLaneInput
): InboundPostRepairValidation {
  if (body.length > args.facts.constraints.max_chars) {
    return {
      ok: false,
      noSendReason: "over_max_chars",
      laneStage: "length_after_repair",
      extraMeta: { v3_candidate_body: body },
    };
  }
  const rt = args.facts.thread.rejected_time_candidates;
  if (rt.length > 0) {
    const hit = validateNoRejectedTimeRepeat(body, rt);
    if (hit != null) {
      return {
        ok: false,
        noSendReason: "rejected_time_repeated",
        laneStage: "rejected_time_validation_failed_after_repair",
        safetySuffix: `rejected_time_repeat:${hit.slice(0, 80)}`,
        extraMeta: { v3_candidate_body: body },
      };
    }
  }
  const blockedAfter = evaluateInboundVoiceWithPraisePolicy(body, args.facts).reasons;
  if (blockedAfter.length > 0) {
    return {
      ok: false,
      noSendReason: "lane_post_validate_blocked",
      laneStage: "post_validate_repair_failed",
      extraMeta: { v3_candidate_body: body, repaired_blocked_reasons: blockedAfter },
    };
  }
  const badSub = validateForbiddenSubstrings(body, args.facts.constraints.forbidden_substrings);
  if (badSub != null) {
    return {
      ok: false,
      noSendReason: "forbidden_substring_violation",
      laneStage: "forbidden_substring_after_repair",
      safetySuffix: `forbidden_hit:${badSub.slice(0, 80)}`,
      extraMeta: { v3_candidate_body: body, forbidden_hit: badSub.slice(0, 120) },
    };
  }
  const staleAsk = detectTurnUnderstandingStaleAskViolation(body, args.facts);
  if (staleAsk.violation) {
    return {
      ok: false,
      noSendReason: "turn_understanding_stale_ask_blocked",
      laneStage: "turn_understanding_stale_ask_validation_failed",
      safetySuffix: "reasked_turn_understanding_do_not_repeat",
      extraMeta: {
        v3_candidate_body: body,
        turn_understanding_stale_ask_phrase: staleAsk.repeatedPhrase,
      },
    };
  }
  const missReq = validateRequiredVerbatimSubstrings(body, args.facts.constraints.required_verbatim_substrings);
  if (missReq != null) {
    return {
      ok: false,
      noSendReason: "required_verbatim_missing",
      laneStage: "required_verbatim_failed_after_repair",
      safetySuffix: `required_verbatim_missing:${missReq.slice(0, 80)}`,
      extraMeta: { v3_candidate_body: body, missing_required_substring: missReq.slice(0, 120) },
    };
  }
  if (shouldRunInboundMemoryRepeatGuard(args.facts)) {
    const repeat = detectSmsMemoryRepeatViolation(buildAntiRepeatDetectArgsFromInboundFacts(args.facts, body));
    if (repeat.hasViolation) {
      return {
        ok: false,
        noSendReason: "thread_memory_repeat_blocked",
        laneStage: "thread_memory_repeat_validation_failed",
        safetySuffix: "reasked_prior_coach_question",
        extraMeta: {
          v3_candidate_body: body,
          memory_repeat_guard_reason: repeat.reason,
          repeated_question: repeat.repeatedQuestion,
        },
      };
    }
  } else if (inboundBodyReasksThreadQuestion(body, args.facts)) {
    return {
      ok: false,
      noSendReason: "thread_memory_reask_blocked",
      laneStage: "thread_memory_reask_validation_failed",
      safetySuffix: "reasked_prior_coach_question",
      extraMeta: { v3_candidate_body: body },
    };
  }
  const freshnessViolation = detectThreadFreshnessViolations(body, args.facts.thread_freshness);
  if (freshnessViolation) {
    return {
      ok: false,
      noSendReason: "thread_freshness_stale_blocked",
      laneStage: "thread_freshness_validation_failed",
      safetySuffix: freshnessViolation.reason,
      extraMeta: {
        v3_candidate_body: body,
        thread_freshness_violation_reason: freshnessViolation.reason,
      },
    };
  }
  return { ok: true };
}

function inboundValidateAfterPostRepair(
  body: string,
  args: InboundV3RelationshipLaneInput
): LanePostValidateRepairValidationResult {
  const post = validateInboundLaneCandidateBody(body, args);
  if (post.ok) {
    return { blockedReasons: [] };
  }

  const rb =
    Array.isArray(post.extraMeta.repaired_blocked_reasons) &&
    post.extraMeta.repaired_blocked_reasons.every((x) => typeof x === "string")
      ? (post.extraMeta.repaired_blocked_reasons as string[])
      : [];

  if (post.noSendReason === "lane_post_validate_blocked" && rb.length > 0) {
    const { hard } = partitionFinalVoiceBlockedReasons(rb);
    return {
      blockedReasons: rb,
      hardReasons: hard.length > 0 ? hard : undefined,
      failedReason: hard.length > 0 ? "hard_after_first_repair" : undefined,
      extraMeta: post.extraMeta,
    };
  }

  const hardReasons = rb.length > 0 ? rb : [post.laneStage];
  return {
    blockedReasons: hardReasons,
    hardReasons,
    missingRequiredVerbatim: post.noSendReason === "required_verbatim_missing",
    failedReason:
      post.noSendReason === "required_verbatim_missing"
        ? "missing_required_verbatim_after_repair"
        : "hard_after_first_repair",
    extraMeta: post.extraMeta,
  };
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
    ...(args.facts.branch_migrated_to_lane === true
      ? {
          branch_migrated_to_lane: true as const,
          branch_name: args.facts.branch_name ?? null,
        }
      : {}),
    ...(args.facts.central_brain_pivot_facts != null
      ? {
          central_brain_pivot_facts_summary: slimCentralBrainPivotFactsForTelemetry(
            args.facts.central_brain_pivot_facts
          ),
        }
      : {}),
    ...(args.facts.arc_clarification_facts != null
      ? {
          arc_clarification_facts_summary: slimArcClarificationFactsForTelemetry(
            args.facts.arc_clarification_facts
          ),
        }
      : {}),
    ...(args.facts.central_brain_blocker_pivot_facts != null
      ? {
          central_brain_blocker_pivot_facts_summary: slimCentralBrainBlockerPivotFactsForTelemetry(
            args.facts.central_brain_blocker_pivot_facts
          ),
        }
      : {}),
    ...(args.facts.blocker_facts != null
      ? { blocker_facts_summary: slimBlockerFactsForTelemetry(args.facts.blocker_facts) }
      : {}),
    ...(args.facts.open_question_facts != null
      ? {
          open_question_facts_summary: slimOpenQuestionFactsForTelemetry(args.facts.open_question_facts),
        }
      : {}),
    ...(args.facts.refresh_facts != null
      ? { refresh_facts_summary: slimRefreshFactsForTelemetry(args.facts.refresh_facts) }
      : {}),
    ...(args.facts.pending_resolution_facts != null
      ? {
          pending_resolution_facts_summary: slimPendingResolutionFactsForTelemetry(
            args.facts.pending_resolution_facts
          ),
        }
      : {}),
    ...(args.facts.memory_confirmation_facts != null
      ? {
          memory_confirmation_facts_summary: slimMemoryConfirmationFactsForTelemetry(
            args.facts.memory_confirmation_facts
          ),
        }
      : {}),
    ...(args.facts.contract_consent_facts != null
      ? {
          contract_consent_facts_summary: slimContractConsentFactsForTelemetry(
            args.facts.contract_consent_facts
          ),
        }
      : {}),
    ...(args.facts.adaptive_consent_clarification_facts != null
      ? {
          adaptive_consent_clarification_facts_summary: slimAdaptiveConsentClarificationFactsForTelemetry(
            args.facts.adaptive_consent_clarification_facts
          ),
        }
      : {}),
    ...(args.facts.commitment_change_facts != null
      ? {
          commitment_change_facts_summary: slimCommitmentChangeFactsForTelemetry(
            args.facts.commitment_change_facts
          ),
        }
      : {}),
    ...(args.facts.commitment_change_context_facts != null
      ? {
          commitment_change_context_facts_summary: slimCommitmentChangeContextFactsForTelemetry(
            args.facts.commitment_change_context_facts
          ),
        }
      : {}),
    ...(args.facts.pending_replacement_facts != null
      ? {
          pending_replacement_facts_summary: {
            pending_resolution_sms_state: args.facts.pending_replacement_facts.pending_resolution_sms_state,
            pending_resolution_applied: args.facts.pending_replacement_facts.pending_resolution_applied,
            candidate_preview:
              args.facts.pending_replacement_facts.pending_candidate_behavior_statement.slice(0, 80),
          },
        }
      : {}),
    ...(args.facts.conversation_brain_fallback_facts != null
      ? {
          conversation_brain_fallback_facts_summary: slimConversationBrainFallbackFactsForTelemetry(
            args.facts.conversation_brain_fallback_facts
          ),
        }
      : {}),
    ...(args.facts.constraints.required_verbatim_substrings?.length
      ? { required_verbatim_substrings: args.facts.constraints.required_verbatim_substrings }
      : {}),
    ...(args.facts.constraints.required_meaning_summary?.trim()
      ? { required_meaning_summary: args.facts.constraints.required_meaning_summary }
      : {}),
    coalesced_inbound_body: args.facts.thread.coalesced_inbound_text,
    suppressed_message_sids: args.facts.thread.suppressed_message_sids,
    rejected_time_candidates: args.facts.thread.rejected_time_candidates,
    unavailable_windows: args.facts.thread.unavailable_windows,
    voice_writer_chain: ["v3_inbound_relationship_lane", "north_star_validator", "final_voice_gate"],
    ...slimTurnUnderstandingMetadata(args.facts.turn_understanding),
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

  const relationshipPacket = buildRelationshipPacketForOpenAI({
    lane: "inbound",
    sourceFacts: args.facts,
    commitmentRow: args.commitmentRow ?? null,
  });
  Object.assign(
    baseMeta,
    relationshipPacketMetaForLaneTelemetry(relationshipPacket.meta, relationshipPacket.snapshotV2Meta)
  );
  const routePurposeAux = buildRoutePurposeAux(args.facts) + buildMemoryPacketRouteAux(args.facts);

  let strategyCardUserAppendix = "";
  let strategyCardPromptGuidance = "";
  const strategyCardEligible = isInboundNormalStrategyCardEligible(args.facts);
  if (strategyCardEligible) {
    const strategyCtx = buildStrategyCardContextFromSnapshot({
      facts: args.facts,
      snapshot: relationshipPacket.snapshotV2,
    });
    const draftCard = buildInboundNormalStrategyCardV1({ ctx: strategyCtx });
    const validated = validateAndRepairInboundNormalStrategyCardV1(draftCard, strategyCtx);
    strategyCardUserAppendix = strategyCardV1UserPromptAppendix(validated.card);
    strategyCardPromptGuidance = buildStrategyCardV1PromptGuidance();
    Object.assign(baseMeta, strategyCardV1MetaForTelemetry(validated));
  }

  const singleMissRecoveryGuidance = strategyCardEligible
    ? ""
    : buildSingleMissRecoveryLaneGuardrails(args.facts.miss_adjustment_policy);

  const system = `You are writing the NEXT SMS in one long coaching relationship (months of thread). This is not an isolated ticket, form submission, or chatbot reset.

RULES:
- Use RELATIONSHIP_PACKET_V1 only as facts — never copy labeled machine drafts, template banks, or "prior hint" wording as your voice.
${buildRelationshipPacketPromptGuidance()}
${strategyCardPromptGuidance}
- thread.memory_authority.projection_used: when true, thread.latest_open_question and thread.latest_answer_after_open_question are server-owned durable projection — they beat runtime guesses and north_star fallbacks.
- RELATIONSHIP_PACKET_V1.recent_exact_thread_72h is the authoritative recent thread — it outranks recent_transcript_lines, body_preview, and coaching summaries.
- If projection says open_question_pending is false and an answer exists: move forward from that answer only when it is proof/outcome — not when the answer is only a forward plan or outcome is still unknown (do not treat intention as completion).
- Do not re-ask questions in thread.memory_packet.last_5_coach_questions unless the user has not answered and you briefly acknowledge that.
- If thread.memory_packet.latest_answer_after_open_question_guess is set, use it — do not ask that question again.
- Read the thread: latest inbound, latest outbound coach SMS, transcript lines, and open-question semantics.
- Honor thread.* memory-correction flags (already_told_you / short_ack / most_recent_substantive_prior_user_message) over older memory when present.
- Anchor to the active commitment (effective ask + state). Do not paste raw title or behavior_statement as a quoted check.
- If the user corrected or rejected something in facts, do not repeat it. If rejected_time_candidates or forbidden_substrings list times or phrases, do not include them in your body.
- If constraints.required_verbatim_substrings is non-empty, the body MUST contain every listed substring exactly (verbatim substring match).
- If constraints.required_meaning_summary is set, the body MUST satisfy that meaning without contradicting server-owned flags in facts.
- If multiple recent lines reflect one combined intent, answer the combined meaning (facts may set split_messages_handled).
- One short SMS, max ${INBOUND_LANE_MAX_CHARS} characters, no newlines, one clear coach move.
- No generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope your", "checking in" as filler).
- Do not use: "what's the next concrete move", "Say it straight", or "Let's confirm" plus a rejected time.
- Do not quote or echo long user text; no truncated quotes.
- If unsafe, uncertain, or facts conflict badly, return should_send false.
${buildThreadFreshnessPromptGuidance()}${buildInboundMeaningAuthorityLaneGuardrails()}${strategyCardEligible ? "" : buildTurnUnderstandingLaneGuardrails()}${buildVictoryBackgroundLaneGuardrails()}${buildInboundProofCalloutLaneGuardrails()}${buildSmsPatternSignalLaneGuardrails()}${buildSmsGoalAdjustmentLaneGuardrails()}${singleMissRecoveryGuidance}${buildPlannedInterruptionLaneGuardrails()}${buildRelationshipExitLaneGuardrails()}${buildIdentityEditLaneGuardrails()}${routePurposeAux}

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[]),
rejected_times_obeyed (boolean), split_messages_handled (boolean)`;

  const user = relationshipPacket.userPromptJson + (strategyCardUserAppendix ? `\n\n${strategyCardUserAppendix}` : "");

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
        "Keys: should_send (boolean), body (string), no_send_reason (string|null), turn_purpose (string), voice_confidence (number 0-1 or null), used_facts (string[]), safety_notes (string[]), rejected_times_obeyed (boolean), split_messages_handled (boolean).",
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
  const turnPurpose = typeof parsed.turn_purpose === "string" ? parsed.turn_purpose.trim() : "inbound_turn";
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
      replySource: "v3_inbound_relationship_lane",
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

  if (body.length > args.facts.constraints.max_chars) {
    return empty("over_max_chars", true, { lane_stage: "length", v3_candidate_body: body, ...laneOpenAiJsonMeta });
  }

  const staleAskEarly = detectTurnUnderstandingStaleAskViolation(body, args.facts);
  if (staleAskEarly.violation) {
    const repairedEarly = await tryResolveStaleAskBlockedInboundBody(body, args, staleAskEarly);
    if (repairedEarly.ok) {
      body = repairedEarly.body;
      laneOpenAiJsonMeta = { ...laneOpenAiJsonMeta, ...repairedEarly.repairMeta };
    } else {
      return empty("turn_understanding_stale_ask_blocked", true, {
        lane_stage: "turn_understanding_stale_ask_validation_failed",
        v3_candidate_body: body,
        turn_understanding_stale_ask_phrase: staleAskEarly.repeatedPhrase,
        ...repairedEarly.repairMeta,
        ...laneOpenAiJsonMeta,
      });
    }
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
          ...laneOpenAiJsonMeta,
          lane_stage: "rejected_time_validation_failed",
          v3_candidate_body: body,
        },
        openAiOk: true,
      };
    }
  }

  const inboundVoice = evaluateInboundVoiceWithPraisePolicy(body, args.facts);
  const blocked = inboundVoice.reasons;
  const praiseMetadata = inboundVoice.praiseMetadata;
  if (blocked.length > 0) {
    const { repairable, hard } = partitionFinalVoiceBlockedReasons(blocked);

    if (hard.length > 0 || repairable.length === 0 || inboundLanePostValidateRepairExcluded(args.facts)) {
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
          ...laneOpenAiJsonMeta,
          lane_stage: "post_validate_blocked",
          v3_candidate_body: body,
          blocked_reasons: blocked,
          ...praiseMetadata,
        },
        openAiOk: true,
      };
    }

    const originalCandidateSnapshot = body;

    const { snapshot: repairSnapshot, meta: snapshotMeta } = prepareRepairSnapshotForOpenAI({
      repairKind: "lane_post_validate",
      routeKind: "inbound",
      routePurpose: args.facts.route_purpose,
      blockedBody: body,
      blockedReasons: repairable,
      laneFacts: args.facts,
      laneBlockedReasons: blocked,
    });

    const repairLoop = await runLanePostValidateRepairLoop({
      routeKind: "inbound",
      routePurpose: args.facts.route_purpose,
      originalBody: body,
      initialBlocked: blocked,
      initialRepairable: repairable,
      repairSnapshot,
      snapshotMeta,
      validateAfterRepair: (candidate) => inboundValidateAfterPostRepair(candidate, args),
    });

    if (!repairLoop.ok) {
      const postFail = validateInboundLaneCandidateBody(repairLoop.repairedBody ?? "", args);
      return {
        body: "",
        shouldSend: false,
        noSendReason: postFail.ok ? "lane_post_validate_blocked" : postFail.noSendReason,
        replySource: "v3_inbound_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [
          ...safetyNotes,
          ...blocked.map((b) => `blocked:${b}`),
          ...(!postFail.ok && postFail.safetySuffix ? [postFail.safetySuffix] : []),
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
          repaired_candidate_body: repairLoop.repairedBody,
          repaired_blocked_reasons: repairLoop.repairedBlockedReasons,
          ...repairLoop.lastRepairMetadata,
          ...snapshotMeta,
          ...repairLoop.telemetry,
          ...(repairLoop.extraMeta ?? {}),
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
      original_candidate_body_preview: bodyPreview(originalCandidateSnapshot),
      repaired_candidate_body: repairLoop.body,
      repaired_blocked_reasons: [],
      ...repairLoop.lastRepairMetadata,
      ...snapshotMeta,
      ...repairLoop.telemetry,
    };
  }

  const freshnessGuard = await applyThreadFreshnessGuard({
    routeKind: "inbound",
    routePurpose: args.facts.route_purpose,
    body,
    factsJson: args.facts,
    freshness: args.facts.thread_freshness,
    enabled: shouldRunInboundThreadFreshnessGuard(args.facts),
  });

  if (freshnessGuard.outcome === "no_send") {
    return empty(freshnessGuard.noSendReason, true, {
      lane_stage: "thread_freshness_guard_failed",
      v3_candidate_body: body,
      ...laneOpenAiJsonMeta,
      ...freshnessGuard.metadata,
    });
  }

  body = freshnessGuard.body;
  if (freshnessGuard.metadata.thread_freshness_repair_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...freshnessGuard.metadata };
  } else if (Object.keys(freshnessGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...freshnessGuard.metadata };
  }

  const memoryRepeatGuard = await applySmsMemoryAntiRepeatGuard({
    routeKind: "inbound",
    routePurpose: args.facts.route_purpose,
    body,
    factsJson: args.facts,
    detectInput: buildAntiRepeatDetectArgsFromInboundFacts(args.facts, body),
    enabled: shouldRunInboundMemoryRepeatGuard(args.facts),
    validateAfterRepair: async (candidate) => {
      const post = validateInboundLaneCandidateBody(candidate, args);
      if (!post.ok) {
        return { ok: false, noSendReason: post.noSendReason, extraMeta: post.extraMeta };
      }
      return { ok: true };
    },
  });

  if (memoryRepeatGuard.outcome === "no_send") {
    return empty(memoryRepeatGuard.noSendReason, true, {
      lane_stage: "thread_memory_repeat_guard_failed",
      v3_candidate_body: body,
      ...laneOpenAiJsonMeta,
      ...memoryRepeatGuard.metadata,
    });
  }

  body = memoryRepeatGuard.body;
  if (memoryRepeatGuard.metadata.memory_repeat_guard_succeeded === true) {
    successLaneStage = "post_validate_repaired";
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
  } else if (Object.keys(memoryRepeatGuard.metadata).length > 0) {
    successRepairExtra = { ...successRepairExtra, ...memoryRepeatGuard.metadata };
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
        ...laneOpenAiJsonMeta,
        lane_stage: "forbidden_substring",
        v3_candidate_body: body,
        forbidden_hit: badSub.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  const staleAskFinal = detectTurnUnderstandingStaleAskViolation(body, args.facts);
  if (staleAskFinal.violation) {
    const repairedFinal = await tryResolveStaleAskBlockedInboundBody(body, args, staleAskFinal);
    if (repairedFinal.ok) {
      body = repairedFinal.body;
      successLaneStage = "post_validate_repaired";
      successRepairExtra = { ...successRepairExtra, ...repairedFinal.repairMeta };
    } else {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "turn_understanding_stale_ask_blocked",
        replySource: "v3_inbound_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, "reasked_turn_understanding_do_not_repeat"],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "turn_understanding_stale_ask_after_memory_repeat",
          v3_candidate_body: body,
          turn_understanding_stale_ask_phrase: staleAskFinal.repeatedPhrase,
          ...repairedFinal.repairMeta,
        },
        openAiOk: true,
      };
    }
  }

  const missReq = validateRequiredVerbatimSubstrings(body, args.facts.constraints.required_verbatim_substrings);
  if (missReq != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "required_verbatim_missing",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `required_verbatim_missing:${missReq.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "required_verbatim_failed",
        v3_candidate_body: body,
        missing_required_substring: missReq.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  const prFacts = args.facts.pending_replacement_facts;
  if (prFacts?.pending_resolution_active && !prFacts.pending_resolution_applied) {
    const truthViolations = detectPendingReplacementStateTruthViolations(body, prFacts);
    if (truthViolations.length > 0) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: pendingReplacementStateTruthNoSendReason(truthViolations),
        replySource: "v3_inbound_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, ...truthViolations.map((v) => `blocked:${v}`)],
        metadata: {
          ...baseMeta,
          ...laneOpenAiJsonMeta,
          lane_stage: "pending_replace_state_truth_blocked",
          v3_candidate_body: body,
          pending_replace_state_truth_blocked_reasons: truthViolations,
        },
        openAiOk: true,
      };
    }
  }

  const seasonViolations = detectSeasonTransitionTruthViolations(
    body,
    args.facts.season_transition_facts
  );
  if (seasonViolations.length > 0) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: seasonTransitionTruthNoSendReason(seasonViolations),
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, ...seasonViolations.map((v) => `blocked:${v}`)],
      metadata: {
        ...baseMeta,
        ...laneOpenAiJsonMeta,
        lane_stage: "season_transition_truth_blocked",
        v3_candidate_body: body,
        season_transition_truth_blocked_reasons: seasonViolations,
      },
      openAiOk: true,
    };
  }

  const finalInboundPraise = evaluateInboundVoiceWithPraisePolicy(body, args.facts);

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
      ...laneOpenAiJsonMeta,
      lane_stage: successLaneStage,
      v3_candidate_body: body,
      v3_lane_turn_purpose: turnPurpose,
      should_send: true,
      ...successRepairExtra,
      ...finalInboundPraise.praiseMetadata,
      praise_policy_context: buildInboundPraisePolicyArgs(body, args.facts),
    },
    openAiOk: true,
  };
}

/** Structured last_error JSON when the inbound V3 relationship lane returns no-send. */
export function formatInboundV3LaneNoSendLastError(
  lane: InboundV3RelationshipLaneResult,
  extras?: Record<string, unknown> | null
): string {
  try {
    return JSON.stringify({
      tag: "inbound_v3_lane_no_send",
      no_send_reason: lane.noSendReason,
      lane_metadata: lane.metadata,
      open_ai_ok: lane.openAiOk,
      ...(extras ?? {}),
    }).slice(0, 8000);
  } catch {
    return "inbound_v3_lane_no_send";
  }
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
  routePurpose?: InboundV3RoutePurpose;
  branchName?: string | null;
  branchMigratedToLane?: boolean;
  centralBrainPivotFacts?: InboundV3CentralBrainPivotFacts | null;
  arcClarificationFacts?: InboundV3ArcClarificationFacts | null;
  centralBrainBlockerPivotFacts?: InboundV3CentralBrainBlockerPivotFacts | null;
  blockerFacts?: InboundV3BlockerFacts | null;
  openQuestionFacts?: InboundV3OpenQuestionFacts | null;
  refreshFacts?: InboundV3RefreshFacts | null;
  pendingResolutionFacts?: InboundV3PendingResolutionFacts | null;
  seasonTransitionFacts?: InboundV3SeasonTransitionFacts | null;
  /** When known (e.g. post pending-resolution handler), overrides applied detection on commitment row. */
  pendingResolutionAppliedOverride?: boolean;
  memoryConfirmationFacts?: InboundV3MemoryConfirmationFacts | null;
  contractConsentFacts?: InboundV3ContractConsentFacts | null;
  adaptiveConsentClarificationFacts?: InboundV3AdaptiveConsentClarificationFacts | null;
  commitmentChangeFacts?: InboundV3CommitmentChangeFacts | null;
  commitmentChangeContextFacts?: InboundV3CommitmentChangeContextFacts | null;
  commsPreferencesFacts?: InboundV3CommsPreferencesFacts | null;
  conversationBrainFallbackFacts?: InboundV3ConversationBrainFallbackFacts | null;
  relationshipMemoryPacket?: SlimSmsRelationshipMemoryPacketForFacts | null;
  victoryBackground?: V3VictoryBackgroundFacts | null;
  patternSignal?: SmsPatternSignalResult | null;
  goalAdjustmentSignal?: SmsGoalAdjustmentSignalResult | null;
  plannedInterruption?: {
    active: boolean;
    reasonCategory: string | null;
    resumeHint: string | null;
  } | null;
  proofCalloutHint?: InboundV3ProofCalloutHint | null;
  relationshipExitFacts?: InboundV3RelationshipExitFacts | null;
  identityEditFacts?: InboundV3IdentityEditFacts | null;
  priorMemoryRepeatNoSend?: InboundPriorMemoryRepeatNoSendContext | null;
  turnUnderstandingReconciled?: ReconciledTurnUnderstanding | null;
  eventsNewestFirst?: V2EventRowForAi[];
};

/** Optional Victory / proof mention — V3-owned; no deterministic post-FVG append. */
export function buildInboundProofCalloutLaneGuardrails(): string {
  return `
PROOF_CALLOUT (v2_accountability.proof_callout_hint when present):
- Optional background only — not required copy.
- If proof_callout_hint.eligible is true, you MAY briefly mention Victory Room or proof naturally in the same SMS (one short clause).
- Do not force a mention; omit if the reply is already complete.
- Do not use a second paragraph solely for a system callout.
- Do not claim proof was saved, logged, or stored unless proof_callout_claim_saved_allowed is true (inbound lane: false before server insert).
- Never paste proof_callout_hint.instruction verbatim; paraphrase naturally.
`;
}

/** Assembles JSON-safe facts for {@link produceInboundV3RelationshipSms} (no upstream prose). */
export function buildInboundV3RelationshipFacts(args: BuildInboundV3RelationshipFactsArgs): InboundV3RelationshipFacts {
  const reqVerb: string[] = [
    ...(args.refreshFacts?.required_verbatim_substrings ?? []),
    ...(args.pendingResolutionFacts?.required_verbatim_substrings ?? []),
    ...(args.memoryConfirmationFacts?.required_verbatim_substrings ?? []),
    ...(args.contractConsentFacts?.required_verbatim_substrings ?? []),
    ...(args.commitmentChangeFacts?.required_verbatim_substrings ?? []),
  ].filter((s) => typeof s === "string" && s.trim().length > 0);
  const pendingReplacementFromCommitment = buildInboundPendingReplacementFactsFromCommitment(
    args.commitment,
    {
      pendingResolutionApplied:
        args.pendingResolutionAppliedOverride === true
          ? true
          : args.pendingResolutionAppliedOverride === false
            ? false
            : undefined,
    }
  );

  const reqMeanRaw =
    args.refreshFacts?.required_meaning_summary?.trim() ||
    pendingReplacementFromCommitment?.required_meaning_summary?.trim() ||
    args.pendingResolutionFacts?.required_meaning_summary?.trim() ||
    args.memoryConfirmationFacts?.required_meaning_summary?.trim() ||
    args.contractConsentFacts?.required_meaning_summary?.trim() ||
    args.adaptiveConsentClarificationFacts?.required_meaning_summary?.trim() ||
    args.commitmentChangeFacts?.required_meaning_summary?.trim() ||
    args.commitmentChangeContextFacts?.required_meaning_summary?.trim() ||
    args.commsPreferencesFacts?.required_meaning_summary?.trim() ||
    args.conversationBrainFallbackFacts?.coaching_route_meaning_summary?.trim() ||
    null;

  const routePurpose = args.routePurpose ?? "normal_inbound_reply";
  const threadMemoryBase = deriveInboundThreadMemoryCorrectionFields({
    recentTranscriptLines: args.transcriptLines,
    currentInbound: args.coalescedInboundText,
    routePurpose,
  });
  const threadMemory = enhanceThreadCorrectionFromMemoryPacket(
    threadMemoryBase,
    args.relationshipMemoryPacket ?? undefined,
    routePurpose
  );
  const mp = args.relationshipMemoryPacket;
  const mergedDoNotRepeat = [...args.doNotRepeatHints, ...(mp?.do_not_repeat_phrases ?? [])];
  if (threadMemory.most_recent_coach_question?.trim()) {
    mergedDoNotRepeat.push(
      `do_not_reask_coach_question:${threadMemory.most_recent_coach_question.trim().slice(0, 140)}`
    );
  }
  if (threadMemory.most_recent_substantive_prior_user_message?.trim()) {
    mergedDoNotRepeat.push(
      `prior_user_answer:${threadMemory.most_recent_substantive_prior_user_message.trim().slice(0, 140)}`
    );
  }

  const inboundMeaning = buildInboundMeaningFacts({
    rawInbound: args.coalescedInboundText,
    receivedAt: new Date(args.localTimeIso),
    timezone: args.timezone,
    classifierEventType: args.deterministicEventType,
    classifierNormalizedHint: null,
    routePriority: buildInboundMeaningRoutePriorityFromV3BuildArgs({
      rawInbound: args.coalescedInboundText,
      pendingResolutionFacts: args.pendingResolutionFacts,
      contractConsentFacts: args.contractConsentFacts,
      relationshipExitFacts: args.relationshipExitFacts,
      identityEditFacts: args.identityEditFacts,
      commitmentChangeFacts: args.commitmentChangeFacts,
      openQuestionFacts: args.openQuestionFacts,
    }),
    openQuestionPending: mp?.open_question_pending === true,
    latestOpenQuestion:
      mp?.latest_open_question ??
      mp?.latest_open_question_guess ??
      args.northStarPacket.latestOpenQuestion ??
      null,
  });

  const turnReconciled = args.turnUnderstandingReconciled ?? null;
  const persistenceForFacts =
    turnReconciled?.reconciled_persistence_decision ?? inboundMeaning.persistence_decision;
  const effectiveInboundMeaning: InboundMeaningFacts =
    turnReconciled != null
      ? { ...inboundMeaning, persistence_decision: persistenceForFacts }
      : inboundMeaning;

  const reconciledFinalEventType = reconcileLegacyAccountabilityEventTypeFromMeaning({
    inboundMeaning: effectiveInboundMeaning,
    gatedFinalEventType: args.gatedDecision.final_event_type ?? null,
  });

  const missAdjustmentPolicy = deriveAdjustmentProposalAllowedByEvidence({
    inboundMeaning: effectiveInboundMeaning,
    inboundRaw: args.coalescedInboundText,
    finalEventType: reconciledFinalEventType,
    routePurpose,
    goalAdjustmentSignal: args.goalAdjustmentSignal ?? null,
    patternSignal: args.patternSignal ?? null,
    eventsNewestFirst: args.eventsNewestFirst,
    adaptiveProposalPending: isV2PendingProposalValid(args.commitment),
    pendingResolutionActive:
      Boolean(args.pendingResolutionFacts) ||
      pendingReplacementFromCommitment?.pending_resolution_active === true,
    commitmentChangeRouteActive: Boolean(
      args.commitmentChangeFacts ||
        args.adaptiveConsentClarificationFacts ||
        args.contractConsentFacts
    ),
  });

  const singleMissRecoveryMeaning =
    buildSingleMissRecoveryRequiredMeaningSummary(missAdjustmentPolicy);
  const reqMeanMerged =
    reqMeanRaw && singleMissRecoveryMeaning
      ? `${reqMeanRaw} ${singleMissRecoveryMeaning}`
      : reqMeanRaw ?? singleMissRecoveryMeaning;

  const facts: InboundV3RelationshipFacts = {
    route_purpose: routePurpose,
    branch_name: args.branchName ?? null,
    branch_migrated_to_lane: args.branchMigratedToLane === true,
    ...(args.centralBrainPivotFacts != null ? { central_brain_pivot_facts: args.centralBrainPivotFacts } : {}),
    ...(args.arcClarificationFacts != null ? { arc_clarification_facts: args.arcClarificationFacts } : {}),
    ...(args.centralBrainBlockerPivotFacts != null
      ? { central_brain_blocker_pivot_facts: args.centralBrainBlockerPivotFacts }
      : {}),
    ...(args.blockerFacts != null ? { blocker_facts: args.blockerFacts } : {}),
    ...(args.openQuestionFacts != null ? { open_question_facts: args.openQuestionFacts } : {}),
    ...(args.refreshFacts != null ? { refresh_facts: args.refreshFacts } : {}),
    ...(args.pendingResolutionFacts != null ? { pending_resolution_facts: args.pendingResolutionFacts } : {}),
    ...(pendingReplacementFromCommitment != null
      ? { pending_replacement_facts: pendingReplacementFromCommitment }
      : {}),
    ...(args.seasonTransitionFacts != null
      ? { season_transition_facts: args.seasonTransitionFacts }
      : {}),
    ...(args.memoryConfirmationFacts != null ? { memory_confirmation_facts: args.memoryConfirmationFacts } : {}),
    ...(args.contractConsentFacts != null ? { contract_consent_facts: args.contractConsentFacts } : {}),
    ...(args.adaptiveConsentClarificationFacts != null
      ? { adaptive_consent_clarification_facts: args.adaptiveConsentClarificationFacts }
      : {}),
    ...(args.commitmentChangeFacts != null ? { commitment_change_facts: args.commitmentChangeFacts } : {}),
    ...(args.commitmentChangeContextFacts != null
      ? { commitment_change_context_facts: args.commitmentChangeContextFacts }
      : {}),
    ...(args.commsPreferencesFacts != null
      ? { comms_preferences_facts: args.commsPreferencesFacts }
      : {}),
    ...(args.conversationBrainFallbackFacts != null
      ? { conversation_brain_fallback_facts: args.conversationBrainFallbackFacts }
      : {}),
    ...(args.victoryBackground != null ? { victory_background: args.victoryBackground } : {}),
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
      ...(args.plannedInterruption?.active
        ? {
            planned_interruption_active: true,
            planned_interruption_reason_category: args.plannedInterruption.reasonCategory,
            planned_interruption_resume_hint: args.plannedInterruption.resumeHint,
          }
        : {}),
    },
    thread: {
      latest_inbound_raw: args.userMessageRaw,
      coalesced_inbound_text: args.coalescedInboundText,
      suppressed_message_sids: args.suppressedMessageSids,
      recent_transcript_lines: args.transcriptLines,
      latest_outbound_coach_sms:
        mp?.last_outbound_full_body ??
        args.northStarPacket.latestOutboundBody ??
        null,
      latest_open_question:
        mp?.latest_open_question ??
        mp?.latest_open_question_guess ??
        args.northStarPacket.latestOpenQuestion ??
        null,
      latest_answer_after_open_question:
        mp?.latest_answer_after_open_question ?? mp?.latest_answer_after_open_question_guess ?? null,
      memory_authority: {
        open_question_source: mp?.latest_open_question
          ? mp.open_question_source === "projection"
            ? "projection"
            : "runtime_guess"
          : mp?.latest_open_question_guess
            ? "runtime_guess"
            : args.northStarPacket.latestOpenQuestion
              ? "north_star"
              : "none",
        answer_source: mp?.latest_answer_after_open_question
          ? mp.answer_source === "projection"
            ? "projection"
            : "runtime_guess"
          : mp?.latest_answer_after_open_question_guess
            ? "runtime_guess"
            : "none",
        projection_used: mp?.projection_used === true,
      },
      expected_reply_semantics: args.northStarPacket.expectedReplySemantics ?? null,
      do_not_repeat_hints: mergedDoNotRepeat.slice(0, 14),
      rejected_time_candidates: args.rejectedTimeCandidates,
      unavailable_windows: args.unavailableWindows,
      ...threadMemory,
      ...(mp
        ? {
            memory_packet: {
              recent_exact_thread_text: mp.recent_exact_thread_text,
              recent_exact_thread_72h: mp.recent_exact_thread_72h,
              relationship_memory_7d: mp.relationship_memory_7d,
              relationship_memory_30d: mp.relationship_memory_30d,
              recent_exact_message_count: mp.recent_exact_message_count,
              last_outbound_full_body: mp.last_outbound_full_body,
              last_inbound_full_body: mp.last_inbound_full_body,
              last_substantive_user_message: mp.last_substantive_user_message,
              last_substantive_coach_message: mp.last_substantive_coach_message,
              last_5_coach_questions: mp.last_5_coach_questions,
              last_5_user_answers: mp.last_5_user_answers,
              latest_open_question: mp.latest_open_question,
              latest_answer_after_open_question: mp.latest_answer_after_open_question,
              open_question_pending: mp.open_question_pending,
              open_question_source: mp.open_question_source,
              answer_source: mp.answer_source,
              projection_used: mp.projection_used,
              latest_open_question_guess: mp.latest_open_question_guess,
              latest_answer_after_open_question_guess: mp.latest_answer_after_open_question_guess,
              do_not_repeat_phrases: mp.do_not_repeat_phrases,
              memory_priority_rules: mp.memory_priority_rules,
            },
          }
        : {}),
    },
    v2_accountability: {
      deterministic_classifier_event: args.deterministicEventType,
      gated_mode: args.gatedDecision.mode,
      final_event_type: reconciledFinalEventType,
      should_write_outcome_event:
        persistenceForFacts === "write_user_yes_today" ||
        persistenceForFacts === "write_user_no" ||
        persistenceForFacts === "write_user_partial",
      reply_style: args.gatedDecision.reply_style ?? null,
      proof_signal:
        inboundMeaningAuthorizesTodayCompleted(effectiveInboundMeaning) &&
        args.northStarPacket.proofSignal === true,
      miss_signal: args.northStarPacket.missSignal === true,
      blocker_signal: args.northStarPacket.blockerSignal === true,
      today_completed:
        inboundMeaningAuthorizesTodayCompleted(effectiveInboundMeaning) &&
        args.northStarPacket.todayCompleted === true,
      future_intent_hint: args.northStarPacket.futureIntentHint ?? null,
      supplement_commitment_change_guidance: args.gatedDecision.supplement_commitment_change_guidance === true,
      ...(args.patternSignal
        ? {
            pattern_signal_confidence: args.patternSignal.confidence,
            pattern_canonical: args.patternSignal.canonical,
            pattern_mention_allowed: args.patternSignal.mentionAllowed,
            pattern_internal_hint: args.patternSignal.internalHint,
          }
        : {}),
      ...(args.goalAdjustmentSignal
        ? {
            goal_adjustment_move: args.goalAdjustmentSignal.move,
            goal_adjustment_confidence: args.goalAdjustmentSignal.confidence,
            goal_adjustment_mention_allowed: args.goalAdjustmentSignal.mentionAllowed,
            goal_adjustment_internal_hint: args.goalAdjustmentSignal.internalHint,
            goal_adjustment_requires_confirmation: args.goalAdjustmentSignal.requiresUserConfirmation,
            goal_adjustment_compatible_flow: args.goalAdjustmentSignal.compatibleFlow,
          }
        : {}),
      ...(args.proofCalloutHint ? { proof_callout_hint: args.proofCalloutHint } : {}),
      adjustment_proposal_allowed_by_evidence:
        missAdjustmentPolicy.adjustment_proposal_allowed_by_evidence,
      single_miss_recovery_required: missAdjustmentPolicy.single_miss_recovery_required,
      adjustment_evidence_reason: missAdjustmentPolicy.adjustment_evidence_reason,
      ...((args.relationshipExitFacts || args.identityEditFacts)
        ? {
            proof_signal: false,
            today_completed: false,
            miss_signal: false,
          }
        : {}),
    },
    ...(args.relationshipExitFacts ? { relationship_exit: args.relationshipExitFacts } : {}),
    ...(args.identityEditFacts ? { identity_edit: args.identityEditFacts } : {}),
    ...(args.priorMemoryRepeatNoSend != null
      ? { memory_repeat_escalation: args.priorMemoryRepeatNoSend }
      : {}),
    inbound_meaning: effectiveInboundMeaning,
    ...(turnReconciled ? { turn_understanding: turnReconciled } : {}),
    miss_adjustment_policy: missAdjustmentPolicy,
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
  if (reqVerb.length > 0) {
    facts.constraints.required_verbatim_substrings = reqVerb;
  }
  if (reqMeanMerged) {
    facts.constraints.required_meaning_summary = reqMeanMerged;
  }
  if (threadMemory.memory_correction_should_use_prior_user_answer) {
    const cq = threadMemory.most_recent_coach_question?.trim();
    if (cq && cq.length >= 12) {
      facts.constraints.forbidden_substrings = [
        ...(facts.constraints.forbidden_substrings ?? []),
        cq.slice(0, Math.min(80, cq.length)),
      ];
    }
    facts.constraints.forbidden_substrings = [
      ...(facts.constraints.forbidden_substrings ?? []),
      "what story will you dictate",
    ];
  }
  if (threadMemory.short_ack_should_not_reask_question) {
    facts.constraints.forbidden_substrings = [
      ...(facts.constraints.forbidden_substrings ?? []),
      "what story will you dictate",
    ];
    const cq = threadMemory.most_recent_coach_question?.trim();
    if (cq && cq.length >= 12) {
      facts.constraints.forbidden_substrings = [
        ...(facts.constraints.forbidden_substrings ?? []),
        cq.slice(0, Math.min(80, cq.length)),
      ];
    }
  }
  if (turnReconciled?.reconciled_do_not_repeat_asks.length) {
    const forbidden = [...(facts.constraints.forbidden_substrings ?? [])];
    for (const phrase of turnReconciled.reconciled_do_not_repeat_asks) {
      const t = phrase.trim();
      if (t.length >= 12) forbidden.push(t.slice(0, Math.min(120, t.length)));
    }
    facts.constraints.forbidden_substrings = [...new Set(forbidden)];
  }
  facts.thread_freshness = deriveRecentThreadFreshnessFacts({
    recentExactThreadText: mp?.recent_exact_thread_text ?? null,
    recentTranscriptLines: args.transcriptLines,
    last5UserAnswers: mp?.last_5_user_answers ?? [],
    latestUserInbound: args.coalescedInboundText,
    latestCoachQuestion:
      threadMemory.most_recent_coach_question ??
      mp?.latest_open_question ??
      args.northStarPacket.latestOpenQuestion ??
      null,
    accountabilityDayKey: inboundMeaning.reported_for_day_key ?? inboundMeaning.spoken_local_day_key,
    timezone: args.timezone,
  });
  facts.temporal_contract = buildTemporalContractForInbound({
    timezone: args.timezone,
    receivedAt: new Date(args.localTimeIso),
    inboundMeaning,
  });
  const derivedMove = deriveInboundCoachingMoveForFacts(facts);
  facts.suggested_coaching_move = derivedMove.move;
  facts.coaching_move_source = derivedMove.coaching_move_source;
  if (derivedMove.conversation_brain_fallback_suppressed_by_turn_understanding != null) {
    facts.conversation_brain_fallback_suppressed_by_turn_understanding =
      derivedMove.conversation_brain_fallback_suppressed_by_turn_understanding;
  }
  return facts;
}

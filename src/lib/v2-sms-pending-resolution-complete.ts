/**
 * Wave 4.1 — Complete SMS-only tighten/replace using pending_resolution_* + server RPCs.
 * AI does not mutate commitments; this module applies v2_apply_guided_commitment_replace_mutation
 * and the overlay consent path (persist + v2_apply_overlay_consent_mutation) only after confirmation.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  normalizeShrinkProposalBindingText,
  persistContractOverlayProposed,
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
} from "@/lib/v2-adaptive-contract";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { applyCanonicalGoalChangeWithSeasonMutation } from "@/lib/v2-apply-canonical-goal-change";
import type { SmsGoalSeasonMutationResult } from "@/lib/v2-sms-goal-season-mutation";
import {
  deriveSeasonModeForSmsGoalChange,
  resolveSeasonModeForPendingReplace,
  type SmsSeasonMode,
} from "@/lib/v2-sms-season-mode";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  mergeSmsPendingResolutionPayload,
  type V2PendingResolutionKind,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import {
  tryExtractV2SmsPendingResolutionCandidateAi,
  V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN,
} from "@/lib/v2-ai-sms-pending-candidate";
import {
  buildInboundSmsSafetyReplyBody,
  classifyInboundSmsSafetyTier,
  isUnsafeSmsGoalCandidateText,
} from "@/lib/sms-inbound-safety";
import {
  extractCandidateBarsFromSms,
  extractDurationAnchoredBarPhrase,
  isIdentityLikeGoalCandidate,
} from "@/lib/v2-sms-commitment-change";
import { getRecentV2EventsForAi } from "@/lib/v2-commitment";
import {
  appendSmsParagraphIfUnderCap,
  buildProofMomentCommitmentReplaced,
  buildProofMomentCommitmentTightened,
  decideVictoryRoomSmsCallout,
  insertSmsCommitmentChangeProofEvent,
  patchVictoryCalloutOnSpineEventBestEffort,
} from "@/lib/v2-proof-moment";
import type { PendingResolutionNoSendPolicyBranch } from "@/lib/v2-pending-resolution-no-send-truth";
export type { PendingResolutionNoSendPolicyBranch } from "@/lib/v2-pending-resolution-no-send-truth";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { interpretCommitmentMeaningFromUserText } from "@/lib/v2-commitment-meaning-interpreter/commitment-meaning-interpreter";
import { COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION } from "@/lib/v2-commitment-meaning-interpreter/types";
import { finalizePhase1HumanSms } from "@/lib/v2-human-sms-brain/finalize-phase1-human-sms";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import {
  isV2PendingResolutionVictoryCalloutAllowed,
  shouldRunCommitmentInterpreterForPendingResolution,
  shouldRunHumanSmsPipelineForPendingResolution,
} from "@/lib/v2-human-sms-brain/flags";
import { isThinCommitmentBarForVictoryCallout } from "@/lib/v2-human-sms-brain/thin-commitment-bar-for-victory";

const BEHAVIOR_MAX = 2000;
const RAW_LOG_MAX = 280;
const AI_REASONING_STORE_MAX = 220;

/** Non-speakable legacy preview when bundled RPC fails after YES — V3 owns final wording. */
function buildSmsPendingRpcHoldPreviewDraft(cand: string): string {
  return `I couldn't safely update that yet. I still have the goal you asked for: ${cand}. Send YES again, or send the cleaner version you want me to use.`;
}

export type PendingConfirmationParse = "yes" | "no" | "ambiguous";

const PENDING_CONFIRM_CONTRADICTION_RE =
  /\b(but\s+change|except|instead|different|not\s+that|wrong|adjust|amend|revise)\b/i;

const PENDING_CONFIRM_YES_PHRASE_RES: RegExp[] = [
  /\bconfirm(ed)?\b/i,
  /\block(?:\s+it)?\s+in\b/i,
  /\b(that'?s|thats)\s+right\b/i,
  /\bcorrect\b/i,
  /\bsounds\s+good\b/i,
  /\bi\s+agree\b/i,
  /\bgo\s+ahead\b/i,
  /\bplease\s+do\b/i,
  /\bmake\s+it\s+that\b/i,
  /\bset\s+it\b/i,
  /\bupdate\s+it\b/i,
  /\bput\s+it\s+on\s+(?:the\s+)?calendar\b/i,
  /\bdo\s+it\b/i,
];

function hasPendingConfirmContradiction(lower: string, trimmed: string): boolean {
  if (PENDING_CONFIRM_CONTRADICTION_RE.test(lower)) return true;
  if (/\b(don'?t|do not)\b/i.test(lower)) return true;
  if (/^no[,.!\s]/i.test(trimmed)) return true;
  if (/^yes[,.!\s].*\b(not\s+that|no)\b/i.test(lower)) return true;
  return false;
}

function hasPendingConfirmYesLanguage(lower: string): boolean {
  return PENDING_CONFIRM_YES_PHRASE_RES.some((re) => re.test(lower));
}

export function mapPendingConfirmationParseToUserAnswerType(
  parse: PendingConfirmationParse
): string {
  switch (parse) {
    case "yes":
      return "pending_confirmed";
    case "no":
      return "pending_rejected";
    case "ambiguous":
      return "pending_confirmation_ambiguous";
  }
}

export function pendingConfirmationParseReason(parse: PendingConfirmationParse): string {
  switch (parse) {
    case "yes":
      return "pending_confirm_language_detected";
    case "no":
      return "pending_reject_language_detected";
    case "ambiguous":
      return "pending_confirm_unclear";
  }
}

export function parseSmsConfirmation(raw: string): PendingConfirmationParse {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (!lower) return "ambiguous";

  if (/^(yes|yep|yeah|yup|y)$/i.test(t)) return "yes";
  if (/^(i\s+agree|sounds\s+good|ok|okay)\.?!?$/i.test(t)) return "yes";
  if (/^(no|nope|nah|n)$/i.test(t)) return "no";

  if (/\b(not that|wrong|change it)\b/i.test(lower)) return "no";
  // Compound "no, <alternative bar>" stays ambiguous — documented A3 limitation.
  if (/^no,\s+/i.test(t) && !/\b(change it|not that|wrong)\b/i.test(lower)) {
    return "ambiguous";
  }
  if (/^no[,.!\s]/i.test(t)) return "no";

  if (hasPendingConfirmYesLanguage(lower)) {
    if (hasPendingConfirmContradiction(lower, t)) return "ambiguous";
    if (/\b(no|not|wrong|change)\b/i.test(lower) && !/\bconfirm(ed)?\b/i.test(lower)) {
      return "ambiguous";
    }
    return "yes";
  }

  return "ambiguous";
}

function looksLikeCancellation(raw: string): boolean {
  return /\b(never mind|nevermind|forget it|cancel that|skip this|abort)\b/i.test(raw.trim());
}

/** Skip AI when the inbound is almost certainly not a bar candidate (short yes/no, etc.). */
function shouldAttemptAiCandidateExtraction(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 5) return false;
  if (looksLikeCancellation(t)) return false;
  if (isAcknowledgmentOrMetaChangeRequestOnly(t)) return false;
  if (t.length <= 20) {
    const conf = parseSmsConfirmation(t);
    if (conf === "yes" || conf === "no") return false;
  }
  return true;
}

const RESERVED_CANDIDATE =
  /^(yes|yeah|yep|yup|y|no|nope|nah|n|same|idk|i\s*dk|maybe|ok|okay|k|sure|n\/a|i\s+agree|sounds\s+good)$/i;

/** Standalone acknowledgments / meta change-requests — never valid candidate goals by themselves. */
const META_CHANGE_REQUEST_ONLY_RE =
  /^(i\s+(want|need)\s+a\s+change|change\s+it|let'?s\s+change(\s+it)?|i\s+want\s+to\s+change(\s+my\s+goal)?|that\s+goal\s+isn'?t\s+right|not\s+that\s+goal|what\s+is\s+the\s+lock|what\s+does\s+(the\s+)?lock\s+mean)[\s.!?]*$/i;

/**
 * Candidate hygiene: short acknowledgments and meta change-requests are not goals.
 * Does not route conversation — only invalidates candidate_behavior_statement values.
 * "I agree to [concrete behavior]" remains eligible via the concrete clause.
 */
export function isAcknowledgmentOrMetaChangeRequestOnly(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return true;
  const bare = t.replace(/[.!?]+$/g, "").trim();
  if (RESERVED_CANDIDATE.test(bare)) return true;
  if (META_CHANGE_REQUEST_ONLY_RE.test(t)) return true;
  if (/^(i\s+agree|sounds\s+good|yes|yeah|yep|yup|ok|okay|sure)[\s.!?]*$/i.test(t)) return true;
  // Confusion about internal jargon without a concrete daily behavior.
  if (
    /\b(what\s+(is|does)\s+(the\s+)?lock|what\s+i\s+agree|the\s+lock)\b/i.test(t) &&
    !/\b(every\s+day|each\s+day|daily|minutes?|steps?|walk|read|compliment|pray|call|write)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function isVagueOrInvalidCandidateBar(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (isIdentityLikeGoalCandidate(t)) return true;
  if (!t || t.length < 3) return true;
  if (t.length > BEHAVIOR_MAX) return true;
  if (isAcknowledgmentOrMetaChangeRequestOnly(t)) return true;
  if (RESERVED_CANDIDATE.test(t)) return true;
  if (/^(be better|do better|try harder|just\s+be|more)$/i.test(t)) return true;
  if (/^(my kids|our kids|the kids|whatever)$/i.test(t)) return true;
  if (/^i\s*(don'?t|do not)\s*know\.?$/i.test(t)) return true;
  if (/^(feel healthier|be happier)$/i.test(t)) return true;
  if (t.length < 8 && !/\d/.test(t) && !/\b(walk|read|run|write|pray|call|go|do|lift|study|meditat)/i.test(t)) {
    return true;
  }
  return false;
}

export function extractDeterministicDailyBarCandidate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (isAcknowledgmentOrMetaChangeRequestOnly(trimmed)) return null;

  const durEx = extractDurationAnchoredBarPhrase(trimmed, BEHAVIOR_MAX);
  if (durEx.mode === "deferred") {
    console.info("[sms-pending-candidate] deterministic_duration_deferred_ai", {
      reason: "bare_duration_rich_context",
      preview: trimmed.slice(0, 120),
    });
  }
  if (durEx.phrase) {
    if (durEx.mode === "widened") {
      console.info("[sms-pending-candidate] deterministic_duration_widened", {
        preview: durEx.phrase.slice(0, 100),
      });
    }
    if (!isVagueOrInvalidCandidateBar(durEx.phrase)) return durEx.phrase;
  }

  const heur = extractCandidateBarsFromSms(trimmed);
  if (heur.candidateNewBar?.trim() && !isVagueOrInvalidCandidateBar(heur.candidateNewBar)) {
    return heur.candidateNewBar.trim();
  }
  if (heur.candidateTightenedBar?.trim() && !isVagueOrInvalidCandidateBar(heur.candidateTightenedBar)) {
    return heur.candidateTightenedBar.trim();
  }

  // "I agree to [concrete daily behavior]" — strip ack wrapper; keep the behavior clause.
  const agreeTo = trimmed.match(/^i\s+agree\s+(?:to|that)\s+(.+)$/i);
  if (agreeTo?.[1]?.trim()) {
    const clause = agreeTo[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (clause.length >= 8 && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  if (/\b(one\s+story|one\s+page|a\s+chapter)\b/i.test(trimmed) && trimmed.length <= 200) {
    const story = trimmed.slice(0, BEHAVIOR_MAX);
    return isVagueOrInvalidCandidateBar(story) ? null : story;
  }

  // No raw full-body fallback: meta goal-change requests and other unstructured
  // inbound must not become candidate_behavior_statement. Concrete bars come from
  // structured extractors above, TU/AI/meaning interpreter, or an existing pending candidate.
  return null;
}

function clampCandidateForKind(kind: V2PendingResolutionKind, text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (kind === "commitment_tighten") {
    return normalizeShrinkProposalBindingText(t);
  }
  if (!t || t.length > BEHAVIOR_MAX) return null;
  return t;
}

function seasonModePayloadMerge(
  prev: V2SmsPendingResolutionPayload,
  mode: SmsSeasonMode,
  reason: string
): Partial<V2SmsPendingResolutionPayload> {
  if (prev.season_mode === mode) return {};
  return {
    season_mode: mode,
    season_mode_reason: reason,
    season_mode_set_at: new Date().toISOString(),
  };
}

async function applySmsGoalChangeWithSeasonMutation(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  behaviorStatement: string;
  seasonMode: SmsSeasonMode;
  messageSid: string;
}): Promise<SmsGoalSeasonMutationResult | { ok: false; code: string }> {
  return applyCanonicalGoalChangeWithSeasonMutation({
    clerkUserId: args.clerkUserId,
    commitment: args.commitment,
    behaviorStatement: args.behaviorStatement,
    seasonMode: args.seasonMode,
    idempotencyKey: args.messageSid,
    proofMessageSid: args.messageSid,
    memoryReasonCode:
      args.seasonMode === "new_chapter"
        ? "sms_pending_resolution_replace"
        : "sms_pending_resolution_same_season_sync",
    memoryReasonCodeIdempotentReplay: "sms_pending_resolution_replace_raced_winner",
  });
}

async function applySmsTightenMutation(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  proposalBindingText: string;
  inboundMessageSid: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  await clearStaleAdaptiveContractColumns(args.commitment.id);
  const c = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  const nowMs = Date.now();
  if (isV2AdaptiveOverlayActive(c, nowMs)) {
    return { ok: false, code: "overlay_already_active" };
  }
  if (isV2PendingProposalValid(c, nowMs)) {
    return { ok: false, code: "proposal_slot_blocked" };
  }

  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  const idempotencySuffix = `sms_pending:${args.inboundMessageSid}`;

  const persisted = await persistContractOverlayProposed({
    commitmentId: c.id,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    dayKey,
    messageSid: args.inboundMessageSid,
    contractKind: "shrink_ask",
    idempotencySuffix,
    expectedUpdatedAt: c.updated_at,
    requireFreshProposalSlot: true,
    skipEventWrite: false,
  });
  if (!persisted.ok) {
    return { ok: false, code: persisted.error };
  }

  const after = (await getActiveCommitment(args.clerkUserId)) ?? c;
  const act = await activateAdaptiveOverlayFromProposal({
    commitmentId: after.id,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    inboundMessageSid: args.inboundMessageSid,
    contractKind: "shrink_ask",
    expectedProposalExpiresAt: after.adaptive_proposal_expires_at,
    expectedUpdatedAt: after.updated_at,
  });
  if (!act.ok) {
    return { ok: false, code: act.error ?? "activate_failed" };
  }
  await recomputeV2CoachingMemory(after.id, {
    reasonCode: "sms_pending_resolution_tighten_overlay",
  });
  return { ok: true };
}

function logSmsPending(j: Record<string, unknown>) {
  console.info("[sms-pending-resolution]", { wave: "4.1", ...j });
}

export { isThinCommitmentBarForVictoryCallout } from "@/lib/v2-human-sms-brain/thin-commitment-bar-for-victory";

export type SmsPendingBootstrapResult = {
  promoted: boolean;
  candidate: string | null;
  skipReason: string | null;
};

/** Command-only raise phrases must not become candidate_behavior_statement via full-body fallback. */
const RAISE_BAR_COMMAND_ONLY_RE =
  /^(?:this\s+goal\s+is\s+too\s+easy|raise\s+the\s+bar|make\s+it\s+harder|want\s+more|ready\s+for\s+more|increase\s+the\s+bar|harder\s+bar|bigger\s+challenge)\.?$/i;

export function isSmsRaiseBarCommandOnlyText(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return true;
  return RAISE_BAR_COMMAND_ONLY_RE.test(t);
}

function extractBootstrapCandidateForPending(
  raw: string,
  detectedIntent: string | undefined
): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  if (detectedIntent === "sms_raise_bar_request") {
    if (isSmsRaiseBarCommandOnlyText(trimmed)) return null;

    const durEx = extractDurationAnchoredBarPhrase(trimmed, BEHAVIOR_MAX);
    if (durEx.phrase && !isSmsRaiseBarCommandOnlyText(durEx.phrase)) {
      return durEx.phrase;
    }

    const heur = extractCandidateBarsFromSms(trimmed);
    const fromHeur = heur.candidateNewBar?.trim() || heur.candidateTightenedBar?.trim() || null;
    if (fromHeur && !isSmsRaiseBarCommandOnlyText(fromHeur)) return fromHeur;

    return null;
  }

  return extractDeterministicDailyBarCandidate(trimmed);
}

/**
 * Slice A3 — same-turn promotion after Wave 4 creates awaiting_candidate pending.
 * Never promotes raw inbound alone: requires structured extract or existing payload candidate.
 */
export async function bootstrapSmsPendingConfirmationFromInbound(args: {
  commitment: ActiveV2CommitmentRow;
  rawBody: string;
  /** When Wave4 opened an awaiting_candidate shell with no concrete bar, skip raw-body promotion. */
  openedAsAwaitingCandidateShell?: boolean;
}): Promise<SmsPendingBootstrapResult> {
  const pending = getPendingResolutionOrNull(args.commitment);
  if (!pending?.payload || pending.payload.source !== "sms_inbound") {
    return { promoted: false, candidate: null, skipReason: "no_pending" };
  }
  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return { promoted: false, candidate: null, skipReason: "wrong_kind" };
  }
  const smsState = pending.payload.sms_state ?? "awaiting_candidate";
  if (smsState !== "awaiting_candidate") {
    return { promoted: false, candidate: null, skipReason: "not_awaiting_candidate" };
  }

  const raw = args.rawBody.trim();
  if (!raw) {
    return { promoted: false, candidate: null, skipReason: "empty_body" };
  }

  const detectedIntent = pending.payload.detected_intent;
  let extracted = extractBootstrapCandidateForPending(raw, detectedIntent);

  const payloadPreCandidate =
    pending.kind === "commitment_tighten"
      ? pending.payload.candidate_tightened_bar?.trim() ||
        pending.payload.candidate_behavior_statement?.trim() ||
        null
      : pending.payload.candidate_new_bar?.trim() ||
        pending.payload.candidate_behavior_statement?.trim() ||
        null;

  if (
    payloadPreCandidate &&
    !isUnsafeSmsGoalCandidateText(payloadPreCandidate) &&
    !isVagueOrInvalidCandidateBar(payloadPreCandidate)
  ) {
    extracted = payloadPreCandidate;
  }

  if (preferRichTextOverBareDuration(raw, extracted)) {
    extracted = null;
  }

  // Shell opened without a concrete bar: do not promote unless structured extract (or payload) found one.
  if (args.openedAsAwaitingCandidateShell === true && !payloadPreCandidate && !extracted) {
    return { promoted: false, candidate: null, skipReason: "shell_without_concrete_candidate" };
  }

  if (
    detectedIntent === "sms_raise_bar_request" &&
    (!extracted || isSmsRaiseBarCommandOnlyText(extracted))
  ) {
    return { promoted: false, candidate: null, skipReason: "raise_bar_missing_candidate" };
  }
  if (!extracted || isVagueOrInvalidCandidateBar(extracted)) {
    return { promoted: false, candidate: null, skipReason: "vague_or_invalid" };
  }
  if (isUnsafeSmsGoalCandidateText(extracted)) {
    return { promoted: false, candidate: null, skipReason: "unsafe" };
  }
  const clamped = clampCandidateForKind(pending.kind, extracted);
  if (!clamped) {
    return { promoted: false, candidate: null, skipReason: "clamp_failed" };
  }

  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: args.commitment.id,
    merge: (prev) => {
      const season = resolveSeasonModeForPendingReplace({
        payload: prev,
        candidateBar: clamped,
        currentBehaviorStatement: args.commitment.behavior_statement,
      });
      return {
        ...prev,
        sms_state: "awaiting_confirmation",
        candidate_behavior_statement: clamped,
        candidate_tightened_bar: pending.kind === "commitment_tighten" ? clamped : prev.candidate_tightened_bar,
        candidate_new_bar: pending.kind === "commitment_replace" ? clamped : prev.candidate_new_bar,
        confirmation_prompt_sent_at: new Date().toISOString(),
        ...seasonModePayloadMerge(prev, season.mode, season.reason),
      };
    },
  });
  if (!merged.ok) {
    return { promoted: false, candidate: null, skipReason: "merge_failed" };
  }

  return { promoted: true, candidate: clamped, skipReason: null };
}

function preferRichTextOverBareDuration(raw: string, extractedPhrase: string | null): boolean {
  const r = raw.trim();
  if (!extractedPhrase || r.length < 36) return false;
  const ex = extractedPhrase.trim();
  if (
    /^(?:\d{1,3}\s*(?:hours?|hrs?|minutes?|mins?))\s*$/i.test(ex) &&
    /[a-zA-Z]{5,}/.test(r)
  ) {
    return true;
  }
  return false;
}

async function phase1PendingReply(args: {
  machineDraft: string;
  brainCase: HumanSmsBrainCase;
  allowVictoryRoomPhrase: boolean;
  currentBarSummary: string | null;
  safeFallback: string;
}): Promise<string> {
  if (!shouldRunHumanSmsPipelineForPendingResolution()) return args.machineDraft;
  const r = await finalizePhase1HumanSms({
    path: "pending_resolution",
    brainCase: args.brainCase,
    machineDraft: args.machineDraft,
    channel: "pending_resolution",
    allowVictoryRoomPhrase: args.allowVictoryRoomPhrase,
    brainContext: { currentBarSummary: args.currentBarSummary },
    safeFallback: args.safeFallback,
  });
  return r.message;
}

export type PendingResolutionPhase1PolicyHints = {
  pendingNoSendPolicyBranch: PendingResolutionNoSendPolicyBranch;
  pendingResolutionKind: "commitment_replace" | "commitment_tighten";
  pendingStateMutatedBeforeSms: boolean;
  pendingClearedBeforeSms: boolean;
  pendingStillActiveAfterPhase1: boolean;
  pendingResolutionApplied: boolean;
  pendingProgressed?: boolean;
  stateTransitionSummary: string;
};

function pendingHandled(
  replyBody: string,
  hints: PendingResolutionPhase1PolicyHints,
  seasonMutation?: SmsGoalSeasonMutationResult
): Extract<SmsPendingResolutionHandleResult, { handled: true }> {
  return {
    handled: true,
    replyBody,
    seasonMutation,
    ...hints,
  };
}

export type SmsPendingResolutionHandleResult =
  | { handled: false }
  | ({
      handled: true;
      replyBody: string;
      seasonMutation?: SmsGoalSeasonMutationResult;
    } & PendingResolutionPhase1PolicyHints);

export async function tryHandleSmsInboundPendingResolution(args: {
  job: { message_sid: string; raw_body: string | null };
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
}): Promise<SmsPendingResolutionHandleResult> {
  const rawFull = (args.job.raw_body ?? "").trim();
  const rawPreview = rawFull.slice(0, RAW_LOG_MAX);

  await clearPendingResolutionIfExpired(args.commitment.id, args.commitment);
  let c = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;

  const pending = getPendingResolutionOrNull(c);
  if (!pending?.payload || pending.payload.source !== "sms_inbound") {
    return { handled: false };
  }

  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return { handled: false };
  }

  const payload = pending.payload;
  const smsState = payload.sms_state ?? "awaiting_candidate";

  if (smsState === "confirmed" || smsState === "cancelled") {
    return { handled: false };
  }

  const kind = pending.kind;
  const currentBarSummary = c.behavior_statement?.trim() ?? null;

  if (c.accountability_phase === "low_pressure_reactivation") {
    await clearPendingResolution(c.id, { expectedUpdatedAt: c.updated_at });
    await recomputeV2CoachingMemory(c.id, { reasonCode: "sms_pending_cleared_paused" });
    logSmsPending({
      pending_resolution_sms_state: smsState,
      confirmation: null,
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
      detail: "paused_cleared_pending",
    });
    const pausedDraft =
      "I can’t update your commitment while you’re in low-pressure mode. When you’re ready for full accountability again, text me and we’ll set the bar.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: pausedDraft,
        brainCase: "pending_resolution_vague_need_detail",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: pausedDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_cleared_no_mutation",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: true,
        pendingClearedBeforeSms: true,
        pendingStillActiveAfterPhase1: false,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "Pending resolution cleared due to low-pressure reactivation before visible SMS.",
      }
    );
  }

  if (looksLikeCancellation(rawFull) && smsState === "awaiting_candidate") {
    await clearPendingResolution(c.id, { expectedUpdatedAt: c.updated_at });
    await recomputeV2CoachingMemory(c.id, { reasonCode: "sms_pending_resolution_cancelled" });
    logSmsPending({
      pending_resolution_sms_state: "cancelled",
      detected_candidate: null,
      confirmation: "cancel",
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });
    const cancelDraft =
      "Okay—I’ll drop that update for now. Text me anytime you want to adjust the bar.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: cancelDraft,
        brainCase: "pending_resolution_no_problem_reenter",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: cancelDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_cleared_no_mutation",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: true,
        pendingClearedBeforeSms: true,
        pendingStillActiveAfterPhase1: false,
        pendingResolutionApplied: false,
        stateTransitionSummary: "User cancelled pending resolution; pending cleared before visible SMS.",
      }
    );
  }

  if (smsState === "awaiting_confirmation") {
    const cand =
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_tightened_bar?.trim() ||
      payload.candidate_new_bar?.trim() ||
      "";
    if (!cand) {
      await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          sms_state: "awaiting_candidate",
        }),
      });
      const raiseNeedsBar =
        payload.detected_intent === "sms_raise_bar_request";
      const lostDraft = raiseNeedsBar
        ? "What harder goal should I hold you to? One clear action—then tell me YES when it's right."
        : "I lost track of the candidate—what exactly should I hold you to tomorrow? One clear action.";
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: lostDraft,
          brainCase: "pending_resolution_lost_candidate",
          allowVictoryRoomPhrase: false,
          currentBarSummary,
          safeFallback: lostDraft,
        }),
        {
          pendingNoSendPolicyBranch: "pending_active_clarify",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: true,
          pendingClearedBeforeSms: false,
          pendingStillActiveAfterPhase1: true,
          pendingResolutionApplied: false,
          pendingProgressed: true,
          stateTransitionSummary:
            "Lost confirmation candidate; regressed pending to awaiting_candidate before visible SMS.",
        }
      );
    }

    const conf = parseSmsConfirmation(rawFull);
    if (conf === "ambiguous") {
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "ambiguous",
        mutation_attempted: false,
        mutation_success: false,
        rpc: null,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const ambDraft = `Still holding this goal: ${cand}. Is that what you want me to hold you to, or what do you want instead?`;
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: ambDraft,
          brainCase: "pending_resolution_ambiguous_confirm",
          allowVictoryRoomPhrase: false,
          currentBarSummary,
          safeFallback: ambDraft,
        }),
        {
          pendingNoSendPolicyBranch: "pending_active_clarify",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: false,
          pendingClearedBeforeSms: false,
          pendingStillActiveAfterPhase1: true,
          pendingResolutionApplied: false,
          stateTransitionSummary:
            "Confirmation ambiguous; pending remains awaiting_confirmation before visible SMS.",
        }
      );
    }

    if (conf === "no") {
      const merged = await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          sms_state: "awaiting_candidate",
          candidate_behavior_statement: null,
          candidate_tightened_bar: null,
          candidate_new_bar: null,
          confirmation_prompt_sent_at: null,
        }),
      });
      if (!merged.ok) {
        const glitchDraft = "Something glitched—try naming the goal again in one short sentence.";
        return pendingHandled(
          await phase1PendingReply({
            machineDraft: glitchDraft,
            brainCase: "pending_resolution_lost_candidate",
            allowVictoryRoomPhrase: false,
            currentBarSummary,
            safeFallback: glitchDraft,
          }),
          {
            pendingNoSendPolicyBranch: "pending_active_clarify",
            pendingResolutionKind: kind,
            pendingStateMutatedBeforeSms: false,
            pendingClearedBeforeSms: false,
            pendingStillActiveAfterPhase1: true,
            pendingResolutionApplied: false,
            stateTransitionSummary:
              "Reject-no payload merge failed; pending still awaiting_confirmation before visible SMS.",
          }
        );
      }
      logSmsPending({
        pending_resolution_sms_state: "awaiting_candidate",
        detected_candidate: cand,
        confirmation: "no",
        mutation_attempted: false,
        mutation_success: false,
        rpc: null,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const noProbDraft =
        "No problem—what would work better? Send one clear daily action you want me to hold you to.";
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: noProbDraft,
          brainCase: "pending_resolution_no_problem_reenter",
          allowVictoryRoomPhrase: false,
          currentBarSummary,
          safeFallback: noProbDraft,
        }),
        {
          pendingNoSendPolicyBranch: "pending_active_clarify",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: true,
          pendingClearedBeforeSms: false,
          pendingStillActiveAfterPhase1: true,
          pendingResolutionApplied: false,
          pendingProgressed: true,
          stateTransitionSummary:
            "User rejected candidate; reset to awaiting_candidate before visible SMS.",
        }
      );
    }

    c = (await getActiveCommitment(args.clerkUserId)) ?? c;

    if (kind === "commitment_replace") {
      const seasonResolved = resolveSeasonModeForPendingReplace({
        payload,
        candidateBar: cand,
        currentBehaviorStatement: c.behavior_statement,
      });
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: false,
        rpc: "v2_apply_sms_goal_change_with_season_mutation",
        season_mode: seasonResolved.mode,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const rep = await applySmsGoalChangeWithSeasonMutation({
        clerkUserId: args.clerkUserId,
        commitment: c,
        behaviorStatement: cand,
        seasonMode: seasonResolved.mode,
        messageSid: args.job.message_sid,
      });
      if (!rep.ok) {
        logSmsPending({
          pending_resolution_sms_state: "awaiting_confirmation",
          detected_candidate: cand,
          confirmation: "yes",
          mutation_attempted: true,
          mutation_success: false,
          rpc: "v2_apply_sms_goal_change_with_season_mutation",
          season_mode: seasonResolved.mode,
          old_commitment_id: c.id,
          new_commitment_id: null,
          message_sid: args.job.message_sid,
          raw_text_preview: rawPreview,
          error: rep.code,
        });
        const rpcHoldDraft = buildSmsPendingRpcHoldPreviewDraft(cand);
        return pendingHandled(
          await phase1PendingReply({
            machineDraft: rpcHoldDraft,
            brainCase: "pending_resolution_rpc_error_hold",
            allowVictoryRoomPhrase: false,
            currentBarSummary,
            safeFallback: rpcHoldDraft,
          }),
          {
            pendingNoSendPolicyBranch: "pending_active_clarify",
            pendingResolutionKind: kind,
            pendingStateMutatedBeforeSms: false,
            pendingClearedBeforeSms: false,
            pendingStillActiveAfterPhase1: true,
            pendingResolutionApplied: false,
            stateTransitionSummary: `Replace RPC failed (${rep.code}); pending still awaiting_confirmation before visible SMS.`,
          }
        );
      }
      logSmsPending({
        pending_resolution_sms_state: "confirmed",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: true,
        rpc: "v2_apply_sms_goal_change_with_season_mutation",
        season_mode: rep.seasonMode,
        season_transition_applied: rep.seasonTransitionApplied,
        old_commitment_id: rep.oldCommitmentId,
        new_commitment_id: rep.newCommitmentId,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const replaceProof = buildProofMomentCommitmentReplaced();
      const recentReplace = await getRecentV2EventsForAi(rep.newCommitmentId);
      const replaceCallout = decideVictoryRoomSmsCallout({
        proofMeta: replaceProof,
        eventsNewestFirst: recentReplace,
      });
      let vrAppend = replaceCallout.appendToReply;
      const thinReplace =
        kind === "commitment_replace" &&
        isThinCommitmentBarForVictoryCallout(cand) &&
        !isV2PendingResolutionVictoryCalloutAllowed();
      if (thinReplace) {
        vrAppend = null;
      }
      const replaceReply =
        rep.seasonMode === "new_chapter"
          ? `Done. New commitment: ${cand}. I’ll hold you to that tomorrow.`
          : `Done. Updated bar: ${cand}. I’ll hold you to that tomorrow.`;
      let replaceReplyFinal = replaceReply;
      if (rep.seasonMode === "new_chapter") {
        const proofInserted = !rep.idempotentReplay;
        if (proofInserted && vrAppend) {
          const beforeReplaceCallout = replaceReplyFinal;
          replaceReplyFinal = appendSmsParagraphIfUnderCap(replaceReplyFinal, vrAppend);
          if (replaceReplyFinal !== beforeReplaceCallout) {
            await patchVictoryCalloutOnSpineEventBestEffort({
              idempotencyKey: `v2_sms_commitment_change_proof:commitment_replaced:${args.job.message_sid}`,
              spineExtras: replaceCallout.eventPayloadExtras,
            });
          }
        }
      }
      const allowVrReplace = /\bvictory room\b/i.test(replaceReplyFinal);
      const replaceSafeFallback = replaceReply;
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: replaceReplyFinal,
          brainCase: "pending_resolution_replace_applied",
          allowVictoryRoomPhrase: allowVrReplace,
          currentBarSummary,
          safeFallback: replaceSafeFallback,
        }),
        {
          pendingNoSendPolicyBranch: "mutation_applied",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: true,
          pendingClearedBeforeSms: true,
          pendingStillActiveAfterPhase1: false,
          pendingResolutionApplied: true,
          stateTransitionSummary: `SMS pending-resolution replace applied (season_mode=${rep.seasonMode}); pending cleared before visible SMS.`,
        },
        rep
      );
    }

    const normalized = normalizeShrinkProposalBindingText(cand);
    if (!normalized) {
      const fmtDraft =
        "That wording doesn’t fit the safe format from here. What smaller bar should I hold you to—one short sentence?";
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: fmtDraft,
          brainCase: "pending_resolution_clarify_candidate",
          allowVictoryRoomPhrase: false,
          currentBarSummary,
          safeFallback: fmtDraft,
        }),
        {
          pendingNoSendPolicyBranch: "pending_active_no_mutation",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: false,
          pendingClearedBeforeSms: false,
          pendingStillActiveAfterPhase1: true,
          pendingResolutionApplied: false,
          stateTransitionSummary:
            "Tighten candidate failed safe-format validation; pending still awaiting_confirmation before visible SMS.",
        }
      );
    }

    logSmsPending({
      pending_resolution_sms_state: "awaiting_confirmation",
      detected_candidate: cand,
      confirmation: "yes",
      mutation_attempted: true,
      mutation_success: false,
      rpc: "persistContractOverlayProposed+v2_apply_overlay_consent_mutation",
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });

    const tight = await applySmsTightenMutation({
      clerkUserId: args.clerkUserId,
      commitment: c,
      proposalBindingText: normalized,
      inboundMessageSid: args.job.message_sid,
    });

    if (!tight.ok) {
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: false,
        rpc: "persistContractOverlayProposed+v2_apply_overlay_consent_mutation",
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
        error: tight.code,
      });
      const rpcHoldTightDraft = buildSmsPendingRpcHoldPreviewDraft(cand);
        return pendingHandled(
          await phase1PendingReply({
            machineDraft: rpcHoldTightDraft,
            brainCase: "pending_resolution_rpc_error_hold",
            allowVictoryRoomPhrase: false,
            currentBarSummary,
            safeFallback: rpcHoldTightDraft,
          }),
          {
            pendingNoSendPolicyBranch: "pending_active_clarify",
            pendingResolutionKind: kind,
            pendingStateMutatedBeforeSms: false,
            pendingClearedBeforeSms: false,
            pendingStillActiveAfterPhase1: true,
            pendingResolutionApplied: false,
            stateTransitionSummary: `Tighten overlay RPC failed (${tight.code}); pending still awaiting_confirmation before visible SMS.`,
          }
        );
    }

    const reloaded = (await getActiveCommitment(args.clerkUserId)) ?? c;
    await clearPendingResolution(reloaded.id);

    logSmsPending({
      pending_resolution_sms_state: "confirmed",
      detected_candidate: cand,
      confirmation: "yes",
      mutation_attempted: true,
      mutation_success: true,
      rpc: "v2_apply_overlay_consent_mutation",
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });

    const tightenProof = buildProofMomentCommitmentTightened();
    const recentTighten = await getRecentV2EventsForAi(reloaded.id);
    const tightenCallout = decideVictoryRoomSmsCallout({
      proofMeta: tightenProof,
      eventsNewestFirst: recentTighten,
    });
    let vrAppendTight = tightenCallout.appendToReply;
    const thinTighten =
      isThinCommitmentBarForVictoryCallout(normalized) && !isV2PendingResolutionVictoryCalloutAllowed();
    if (thinTighten) {
      vrAppendTight = null;
    }
    let tightenReply = `Done. New bar: ${normalized}. I’ll hold you to that tomorrow.`;
    const proofTightenInserted = await insertSmsCommitmentChangeProofEvent({
      commitmentId: reloaded.id,
      clerkUserId: args.clerkUserId,
      messageSid: args.job.message_sid,
      messagePreview: normalized,
      kind: "commitment_tightened",
    });
    let tightenCalloutShown = false;
    if (proofTightenInserted && vrAppendTight) {
      const beforeTightenCallout = tightenReply;
      tightenReply = appendSmsParagraphIfUnderCap(tightenReply, vrAppendTight);
      tightenCalloutShown = tightenReply !== beforeTightenCallout;
      if (tightenCalloutShown) {
        await patchVictoryCalloutOnSpineEventBestEffort({
          idempotencyKey: `v2_sms_commitment_change_proof:commitment_tightened:${args.job.message_sid}`,
          spineExtras: tightenCallout.eventPayloadExtras,
        });
      }
    }
    const allowVrTight = /\bvictory room\b/i.test(tightenReply);
    const tightenSafeFallback = `Done. New bar: ${normalized}. I’ll hold you to that tomorrow.`;
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: tightenReply,
        brainCase: "pending_resolution_tighten_applied",
        allowVictoryRoomPhrase: allowVrTight,
        currentBarSummary,
        safeFallback: tightenSafeFallback,
      }),
      {
        pendingNoSendPolicyBranch: "mutation_applied",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: true,
        pendingClearedBeforeSms: true,
        pendingStillActiveAfterPhase1: false,
        pendingResolutionApplied: true,
        stateTransitionSummary:
          "SMS pending-resolution tighten overlay applied; pending cleared before visible SMS.",
      }
    );
  }

  let meaningInterpreterAcceptedBar: string | null = null;

  if (shouldRunCommitmentInterpreterForPendingResolution()) {
    const interp = await interpretCommitmentMeaningFromUserText({
      rawUserText: rawFull,
      pendingKind: kind,
      currentBarSummary,
      promptVersion: COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
    });

    await mergeSmsPendingResolutionPayload({
      commitmentId: c.id,
      merge: (prev) => ({
        ...prev,
        meaning_interpreter_ok: interp.ok,
        meaning_interpreter_error: interp.ok ? null : interp.reason,
        ...(interp.ok
          ? {
              meaning_interpreter_prompt_version: interp.promptVersion,
              meaning_interpreter_interpreted_bar: interp.interpreted_daily_bar,
              meaning_interpreter_needs_clarification: interp.needs_clarification,
              meaning_interpreter_clarification_question: interp.clarification_question,
              meaning_interpreter_confidence: interp.confidence,
            }
          : {}),
      }),
    });

    if (interp.ok && interp.needs_clarification) {
      const clarDraft =
        interp.clarification_question?.trim() ||
        "What exactly should I hold you to tomorrow? One clear action.";
      logSmsPending({
        pending_resolution_sms_state: "awaiting_candidate",
        detected_candidate: null,
        confirmation: null,
        mutation_attempted: false,
        mutation_success: false,
        rpc: null,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
        meaning_interpreter_clarification: true,
      });
      return pendingHandled(
        await phase1PendingReply({
          machineDraft: clarDraft,
          brainCase: "pending_resolution_clarify_candidate",
          allowVictoryRoomPhrase: false,
          currentBarSummary,
          safeFallback: clarDraft,
        }),
        {
          pendingNoSendPolicyBranch: "pending_active_clarify",
          pendingResolutionKind: kind,
          pendingStateMutatedBeforeSms: true,
          pendingClearedBeforeSms: false,
          pendingStillActiveAfterPhase1: true,
          pendingResolutionApplied: false,
          stateTransitionSummary:
            "Meaning interpreter requested clarification; pending remains awaiting_candidate before visible SMS.",
        }
      );
    }

    if (
      interp.ok &&
      !interp.needs_clarification &&
      interp.interpreted_daily_bar &&
      interp.confidence >= 0.5
    ) {
      const clampedInterp = clampCandidateForKind(kind, interp.interpreted_daily_bar);
      if (clampedInterp && !isVagueOrInvalidCandidateBar(clampedInterp)) {
        meaningInterpreterAcceptedBar = clampedInterp;
      }
    }
  }

  let extracted = extractDeterministicDailyBarCandidate(rawFull);
  if (!meaningInterpreterAcceptedBar && preferRichTextOverBareDuration(rawFull, extracted)) {
    extracted = null;
  }

  // Never fall back to raw inbound as the candidate — only structured extract, meaning interpreter, or AI.
  let candidateRaw: string | null = meaningInterpreterAcceptedBar ?? extracted ?? null;
  let deterministicGood =
    Boolean(candidateRaw) &&
    !isVagueOrInvalidCandidateBar(candidateRaw!) &&
    clampCandidateForKind(kind, candidateRaw!) !== null;

  if (meaningInterpreterAcceptedBar) {
    deterministicGood = true;
    candidateRaw = meaningInterpreterAcceptedBar;
  }

  let aiMeta: {
    used: boolean;
    accepted: boolean;
    confidence: number | null;
    rejectedReason: string | null;
    reasoningShort: string | null;
  } | null = null;

  if (!deterministicGood && shouldAttemptAiCandidateExtraction(rawFull)) {
    const aiRes = await tryExtractV2SmsPendingResolutionCandidateAi({
      rawInbound: rawFull,
      pendingKind: kind,
      behaviorStatementPreview: c.behavior_statement?.trim() ?? "",
    });

    if (aiRes.attempted && aiRes.ok) {
      const d = aiRes.data;
      const rs = d.reasoning_short.slice(0, AI_REASONING_STORE_MAX);
      const confidenceOk =
        d.has_candidate &&
        d.confidence >= V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN &&
        !d.needs_clarification;
      const aiText = d.candidate_behavior_statement?.trim() ?? "";

      if (confidenceOk && aiText) {
        if (!isVagueOrInvalidCandidateBar(aiText) && clampCandidateForKind(kind, aiText)) {
          candidateRaw = aiText;
          deterministicGood = true;
          aiMeta = {
            used: true,
            accepted: true,
            confidence: d.confidence,
            rejectedReason: null,
            reasoningShort: rs,
          };
        } else {
          aiMeta = {
            used: true,
            accepted: false,
            confidence: d.confidence,
            rejectedReason: "validation_failed",
            reasoningShort: rs,
          };
        }
      } else {
        aiMeta = {
          used: true,
          accepted: false,
          confidence: d.confidence,
          rejectedReason: !d.has_candidate
            ? "no_candidate"
            : d.needs_clarification
              ? "needs_clarification"
              : d.confidence < V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN
                ? "low_confidence"
                : "needs_clarification",
          reasoningShort: rs,
        };
      }
    } else if (aiRes.attempted && !aiRes.ok) {
      aiMeta = {
        used: true,
        accepted: false,
        confidence: null,
        rejectedReason: aiRes.reason,
        reasoningShort: null,
      };
    }
  }

  if (!deterministicGood) {
    if (aiMeta?.used) {
      const meta = aiMeta;
      await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          ai_candidate_extraction_used: true,
          ai_candidate_confidence: meta.confidence,
          ai_candidate_accepted: false,
          ai_candidate_rejected_reason: meta.rejectedReason,
          ai_reasoning_short: meta.reasoningShort,
        }),
      });
    }
    logSmsPending({
      pending_resolution_sms_state: "awaiting_candidate",
      detected_candidate: null,
      confirmation: null,
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
      vague: true,
      ai_candidate_extraction: aiMeta,
    });
    const vagueDraft =
      "I need one clear daily action. What exactly should I hold you to tomorrow?";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: vagueDraft,
        brainCase: "pending_resolution_vague_need_detail",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: vagueDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_active_clarify",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: false,
        pendingClearedBeforeSms: false,
        pendingStillActiveAfterPhase1: true,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "Candidate vague or invalid; pending remains awaiting_candidate before visible SMS.",
      }
    );
  }

  const clamped = clampCandidateForKind(kind, candidateRaw!);
  if (!clamped) {
    const clampDraft =
      kind === "commitment_tighten"
        ? "That’s too long or unclear for a tightened bar here—what’s one shorter honest version?"
        : "That text doesn’t fit as a commitment here—try one clear daily-action sentence.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: clampDraft,
        brainCase: "pending_resolution_clarify_candidate",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: clampDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_active_no_mutation",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: false,
        pendingClearedBeforeSms: false,
        pendingStillActiveAfterPhase1: true,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "Candidate failed clamp validation; pending remains awaiting_candidate before visible SMS.",
      }
    );
  }

  if (isUnsafeSmsGoalCandidateText(clamped) || isUnsafeSmsGoalCandidateText(candidateRaw!)) {
    const unsafeSafety = classifyInboundSmsSafetyTier(clamped);
    const unsafeDraft =
      buildInboundSmsSafetyReplyBody(unsafeSafety) ??
      "Summitt Mindset cannot help with that request. Send me a safe daily commitment and we’ll work from there.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: unsafeDraft,
        brainCase: "pending_resolution_unsafe_candidate",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: unsafeDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_active_no_mutation",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: false,
        pendingClearedBeforeSms: false,
        pendingStillActiveAfterPhase1: true,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "Unsafe candidate rejected; pending remains awaiting_candidate before visible SMS.",
      }
    );
  }

  const mergedOk = await mergeSmsPendingResolutionPayload({
    commitmentId: c.id,
    merge: (prev) => {
      const season =
        kind === "commitment_replace"
          ? resolveSeasonModeForPendingReplace({
              payload: prev,
              candidateBar: clamped,
              currentBehaviorStatement: c.behavior_statement,
            })
          : null;
      return {
        ...prev,
        sms_state: "awaiting_confirmation",
        candidate_behavior_statement: clamped,
        candidate_tightened_bar: kind === "commitment_tighten" ? clamped : prev.candidate_tightened_bar,
        candidate_new_bar: kind === "commitment_replace" ? clamped : prev.candidate_new_bar,
        confirmation_prompt_sent_at: new Date().toISOString(),
        ...(season ? seasonModePayloadMerge(prev, season.mode, season.reason) : {}),
        ...(aiMeta?.accepted
          ? {
              ai_candidate_extraction_used: true,
              ai_candidate_confidence: aiMeta.confidence,
              ai_candidate_accepted: true,
              ai_candidate_rejected_reason: null,
              ai_reasoning_short: aiMeta.reasoningShort,
            }
          : {
              ai_candidate_extraction_used: false,
              ai_candidate_confidence: null,
              ai_candidate_accepted: null,
              ai_candidate_rejected_reason: null,
              ai_reasoning_short: null,
            }),
      };
    },
  });
  if (!mergedOk.ok) {
    const saveGlitchDraft =
      "Something glitched saving that—try your candidate again in one short sentence.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: saveGlitchDraft,
        brainCase: "pending_resolution_lost_candidate",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: saveGlitchDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_active_clarify",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: false,
        pendingClearedBeforeSms: false,
        pendingStillActiveAfterPhase1: true,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "Candidate save merge failed; pending remains awaiting_candidate before visible SMS.",
      }
    );
  }

  logSmsPending({
    pending_resolution_sms_state: "awaiting_confirmation",
    detected_candidate: clamped,
    confirmation: "prompted",
    mutation_attempted: false,
    mutation_success: false,
    rpc: null,
    old_commitment_id: c.id,
    new_commitment_id: null,
    message_sid: args.job.message_sid,
    raw_text_preview: rawPreview,
    ai_candidate_extraction: aiMeta,
  });

  if (kind === "commitment_tighten") {
    const tightenPromptDraft = `I can tighten it to: ${clamped}. Should I make that the new goal?`;
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: tightenPromptDraft,
        brainCase: "pending_resolution_confirmation_prompt",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: tightenPromptDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_active_clarify",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: true,
        pendingClearedBeforeSms: false,
        pendingStillActiveAfterPhase1: true,
        pendingResolutionApplied: false,
        pendingProgressed: true,
        stateTransitionSummary:
          "Candidate saved; pending advanced to awaiting_confirmation before visible SMS.",
      }
    );
  }
  const replaceSeasonResolved = resolveSeasonModeForPendingReplace({
    payload,
    candidateBar: clamped,
    currentBehaviorStatement: c.behavior_statement,
  });
  const replacePromptDraft =
    replaceSeasonResolved.mode === "new_chapter"
      ? `I can change the focus to: ${clamped}. Want me to hold you to that?`
      : `I can raise the standard to: ${clamped}. Want me to hold you to that?`;
  return pendingHandled(
    await phase1PendingReply({
      machineDraft: replacePromptDraft,
      brainCase: "pending_resolution_confirmation_prompt",
      allowVictoryRoomPhrase: false,
      currentBarSummary,
      safeFallback: replacePromptDraft,
    }),
    {
      pendingNoSendPolicyBranch: "pending_active_clarify",
      pendingResolutionKind: kind,
      pendingStateMutatedBeforeSms: true,
      pendingClearedBeforeSms: false,
      pendingStillActiveAfterPhase1: true,
      pendingResolutionApplied: false,
      pendingProgressed: true,
      stateTransitionSummary:
        "Candidate saved; pending advanced to awaiting_confirmation before visible SMS.",
    }
  );
}

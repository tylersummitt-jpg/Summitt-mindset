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
import { isPendingHallwayKeepCurrentClearReply } from "@/lib/sms-coach-goal-evolution-acceptance";
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

/**
 * While awaiting_confirmation with a stored candidate: user asks to apply "my new goal"
 * or complains the displayed goal still shows the old bar.
 * Does not invent candidates — only confirms an existing pending candidate.
 */
export function looksLikeApplyPendingCandidateRequest(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (
    /\b(?:can\s+you\s+|please\s+)?(?:change|update)\s+it\s+to\s+(?:my\s+|the\s+)?new\s+goal\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(victory\s+room|still\s+says|still\s+shows|hasn'?t\s+updated|didn'?t\s+change|not\s+updated)\b/i.test(
      t
    ) &&
    /\b(change|update|make|set|fix)\b/i.test(t) &&
    /\b(goal|it|new)\b/i.test(t)
  ) {
    const toClause = t.match(/\b(?:change|update)\s+it\s+to\s+(.+)$/i);
    if (
      toClause?.[1] &&
      !/\b(?:my\s+|the\s+)?new\s+goal\b/i.test(toClause[1]) &&
      toClause[1].trim().length >= 8
    ) {
      return false;
    }
    return true;
  }
  return false;
}

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

  // Reject "change it" alone — but not "change it to …" or apply-new-goal language.
  if (/\b(not that|wrong)\b/i.test(lower)) return "no";
  if (
    /\bchange\s+it\b/i.test(lower) &&
    !/\bchange\s+it\s+to\b/i.test(lower) &&
    !/\b(?:my\s+|the\s+)?new\s+goal\b/i.test(lower)
  ) {
    return "no";
  }
  // Compound "no, <alternative bar>" stays ambiguous — documented A3 limitation.
  if (/^no,\s+/i.test(t) && !/\b(change it|not that|wrong)\b/i.test(lower)) {
    return "ambiguous";
  }
  if (/^no[,.!\s]/i.test(t)) return "no";

  if (looksLikeApplyPendingCandidateRequest(t)) {
    if (hasPendingConfirmContradiction(lower, t)) return "ambiguous";
    return "yes";
  }

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
  /^(yes[,.\s]+)?(i'?m\s+thinking\s+i\s+need\s+a\s+change|i\s+think\s+i\s+need\s+(a\s+change|to\s+change(\s+my\s+goal)?)|i\s+(want|need)\s+a\s+change|change\s+it|let'?s\s+change(\s+it)?|i\s+(want|need)\s+to\s+change(\s+my\s+goal)?|i\s+(want|need)\s+a\s+different\s+goal|can\s+we\s+change(\s+my)?\s+goal|that\s+goal\s+isn'?t\s+right|not\s+that\s+goal|what\s+is\s+the\s+lock|what\s+does\s+(the\s+)?lock\s+mean)[\s.!?]*$/i;

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
  if (/^(be healthier|healthier|better|more consistent|something different)$/i.test(t)) return true;
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

function capitalizeHallwayAction(action: string): string {
  const a = action.trim().toLowerCase();
  if (!a) return action;
  return a.charAt(0).toUpperCase() + a.slice(1);
}

function normalizeHallwayActionVerb(raw: string): string {
  const a = raw.trim().toLowerCase();
  if (a === "life" || a === "lifting" || a === "lifts") return "lift";
  if (a === "walking" || a === "walks") return "walk";
  if (a === "running" || a === "runs") return "run";
  if (a === "working" || a === "workouts" || a === "workout") return "workout";
  if (a === "training" || a === "trains") return "train";
  if (a === "exercising" || a === "exercises") return "exercise";
  return a.replace(/ing$/, "").replace(/s$/, "") || a;
}

/**
 * Inside commitment_replace awaiting_candidate, a clear behavior phrase can be concrete
 * without numbers/cadence. Still reject outcome-only/vague health language.
 */
function isConcreteHallwayClause(clause: string): boolean {
  const t = clause.trim();
  if (!t || t.length < 8) return false;
  if (isVagueOrInvalidCandidateBar(t)) return false;
  if (
    /\b(more active|become more fit|get(?:ting)? (?:fit|healthy)|in shape|healthier|better|more consistent|something different)\b/i.test(
      t
    ) &&
    !/\b(\d+|times?\s+(?:a|per)|minutes?|steps?|miles?|walk|read|wake|waking|call|bed|before|after|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (
    /\b(\d+|every\s+day|each\s+day|daily|weekly|per\s+week|times?\s+(?:a|per)|minutes?|steps?|miles?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // Lifestyle / timed behavior without a number (e.g. waking up before my kids).
  return /\b(wak(?:e|ing)|get(?:ting)?\s+up|read(?:ing)?|call(?:ing)?|walk(?:ing)?|tak(?:e|ing)|get(?:ting)?\s+to\s+bed|before|after|by\s+\d)\b/i.test(
    t
  );
}

const WEEKDAY_TOKEN_RE =
  /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi;

const WEEKDAY_CANON: Record<string, string> = {
  mon: "Monday",
  monday: "Monday",
  mondays: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  tuesdays: "Tuesday",
  wed: "Wednesday",
  wednesday: "Wednesday",
  wednesdays: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  thursdays: "Thursday",
  fri: "Friday",
  friday: "Friday",
  fridays: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  saturdays: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
  sundays: "Sunday",
};

export function extractWeekdaysFromInbound(raw: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.matchAll(WEEKDAY_TOKEN_RE)) {
    const key = m[1]!.toLowerCase();
    const canon = WEEKDAY_CANON[key];
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      found.push(canon);
    }
  }
  return found;
}

function formatWeekdayList(days: string[]): string {
  if (days.length === 0) return "";
  if (days.length === 1) return days[0]!;
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(", ")}, and ${days[days.length - 1]}`;
}

/** True when inbound is mostly weekday clarification (optionally with light connectors). */
export function isMostlyWeekdayClarification(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || t.length > 80) return false;
  const days = extractWeekdaysFromInbound(t);
  if (days.length === 0) return false;
  const stripped = t
    .replace(WEEKDAY_TOKEN_RE, " ")
    .replace(/\b(on|and|&|,|each|every|week|the|days?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length <= 8;
}

/**
 * Stronger concrete-bar extract used ONLY while sms_state is awaiting_candidate
 * on commitment_replace. Must not be used for normal non-pending inbound.
 */
export function extractAwaitingCandidateHallwayBar(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (isAcknowledgmentOrMetaChangeRequestOnly(trimmed)) return null;

  const det = extractDeterministicDailyBarCandidate(trimmed);
  if (det) return det;

  const freqAction = trimmed.match(
    /\b(lift|life|walk|run|read|pray|write|call|workout|train|exercise|swim|bike|cycle)(?:ing|s)?\s+(?:weights?\s+)?(\d{1,2})\s+times?\s+(?:a|per)\s+week\b/i
  );
  if (freqAction) {
    const action = normalizeHallwayActionVerb(freqAction[1]!);
    const bar = `${capitalizeHallwayAction(action)} ${freqAction[2]} times per week`;
    if (!isVagueOrInvalidCandidateBar(bar)) return bar;
  }

  const wantFreq = trimmed.match(
    /\b(?:i\s+)?(?:just\s+)?want\s+to\s+(?:do\s+(?:the\s+)?)?(lift|life|walk|run|workout|train|exercise)(?:ing|s|ed)?\s+(?:weights?\s+)?(\d{1,2})\s+times?\s+(?:a|per)\s+week\b/i
  );
  if (wantFreq) {
    const action = normalizeHallwayActionVerb(wantFreq[1]!);
    const bar = `${capitalizeHallwayAction(action)} ${wantFreq[2]} times per week`;
    if (!isVagueOrInvalidCandidateBar(bar)) return bar;
  }

  const numActionPerWeek = trimmed.match(
    /\b(?:do\s+(?:the\s+)?)?(\d{1,2})\s+(lift|life|walk|run|workout|train)(?:s|ing)?\s+per\s+week\b/i
  );
  if (numActionPerWeek) {
    const action = normalizeHallwayActionVerb(numActionPerWeek[2]!);
    const bar = `${capitalizeHallwayAction(action)} ${numActionPerWeek[1]} times per week`;
    if (!isVagueOrInvalidCandidateBar(bar)) return bar;
  }

  const actionOnDays = trimmed.match(
    /\b(lift|walk|run|train|workout)(?:ing|s)?\s+(?:weights?\s+)?on\s+(.+)$/i
  );
  if (actionOnDays) {
    const days = extractWeekdaysFromInbound(actionOnDays[2]!);
    if (days.length > 0) {
      const action = normalizeHallwayActionVerb(actionOnDays[1]!);
      const bar = `${capitalizeHallwayAction(action)} on ${formatWeekdayList(days)} each week`;
      if (!isVagueOrInvalidCandidateBar(bar)) return bar;
    }
  }

  const wantGoalToBe = trimmed.match(
    /\b(?:i\s+)?(?:just\s+)?want\s+(?:my\s+)?(?:new\s+)?goal\s+to\s+be\s+(.{8,180}?)(?:[.!?]|$)/i
  );
  if (wantGoalToBe?.[1]?.trim()) {
    const clause = wantGoalToBe[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (isConcreteHallwayClause(clause) && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  const newGoalToBe = trimmed.match(
    /\b(?:my\s+)?new\s+goal\s+to\s+be\s+(.{8,180}?)(?:[.!?]|$)/i
  );
  if (newGoalToBe?.[1]?.trim()) {
    const clause = newGoalToBe[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (isConcreteHallwayClause(clause) && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  const changeGoalTo = trimmed.match(
    /\b(?:(?:i\s+)?(?:want|need)\s+to\s+)?change\s+(?:my\s+)?goal\s+to\s+(.{8,180}?)(?:[.!?]|$)/i
  );
  if (changeGoalTo?.[1]?.trim()) {
    const clause = changeGoalTo[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (isConcreteHallwayClause(clause) && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  const makeMyGoal = trimmed.match(/\bmake\s+(?:my\s+)?goal\s+(.{8,180}?)(?:[.!?]|$)/i);
  if (makeMyGoal?.[1]?.trim()) {
    const clause = makeMyGoal[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (isConcreteHallwayClause(clause) && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  const changeItTo = trimmed.match(
    /\b(?:can\s+you\s+|please\s+)?change\s+it\s+to\s+(.{8,180}?)(?:[.!?]|$)/i
  );
  if (changeItTo?.[1]?.trim() && !/\b(?:my\s+|the\s+)?new\s+goal\b/i.test(changeItTo[1]!)) {
    const clause = changeItTo[1].trim().replace(/\s+/g, " ").slice(0, BEHAVIOR_MAX);
    if (isConcreteHallwayClause(clause) && !isVagueOrInvalidCandidateBar(clause)) return clause;
  }

  return null;
}

export function tryMergeWeekdaysIntoCandidate(
  existingCandidate: string,
  rawInbound: string
): string | null {
  if (!isMostlyWeekdayClarification(rawInbound)) return null;
  const days = extractWeekdaysFromInbound(rawInbound);
  if (days.length === 0) return null;
  const existing = existingCandidate.trim();
  const dayPhrase = formatWeekdayList(days);
  if (/\blift/i.test(existing)) {
    return `Lift on ${dayPhrase} each week`;
  }
  if (/\b(walk|run|train|workout|exercise)/i.test(existing)) {
    const verbMatch = existing.match(/\b(walk|run|train|workout|exercise)\b/i);
    const verb = capitalizeHallwayAction(normalizeHallwayActionVerb(verbMatch?.[1] ?? "workout"));
    return `${verb} on ${dayPhrase} each week`;
  }
  if (existing) {
    const base = existing.replace(/\.$/, "");
    return `${base} on ${dayPhrase}`;
  }
  return null;
}

export function isBroadReplacementDirection(raw: string): boolean {
  const t = raw.trim();
  if (!t || extractAwaitingCandidateHallwayBar(t)) return false;
  const lower = t.toLowerCase();
  const direction =
    /\b(more active|more fit|in shape|get(?:ting)? (?:fit|healthy)|start scheduling|throughout the week|become more)\b/i.test(
      lower
    );
  const domain = /\b(workout|work outs?|exercise|active|fit|fitness|health)\b/i.test(lower);
  return direction && domain;
}

export function buildBroadDirectionHallwayDraft(raw: string): string {
  if (/\bschedule/i.test(raw) && /\bworkout/i.test(raw)) {
    return "Good. Should your new goal be scheduling workouts each week, or completing workouts each week?";
  }
  return "Got it. What new goal do you want me to hold you to — one clear action I can check?";
}

export function isReplacementNotMergeLanguage(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return (
    /\b(instead of|switch(?:ing)? (?:my )?focus|don'?t want to (?:run|do cardio|keep)|rather than)\b/i.test(
      t
    ) ||
    /\b(?:lift|lifting).{0,50}instead of (?:cardio|running)\b/i.test(t) ||
    /\binstead of (?:cardio|running).{0,50}(?:lift|lifting)\b/i.test(t)
  );
}

export function buildReplacementNotMergeHallwayDraft(raw: string): string {
  if (/\blift/i.test(raw)) {
    return "Got it — lifting instead of the old goal. How many times per week do you want me to hold you to lifting?";
  }
  return "Got it — we're replacing the old goal. What new goal do you want me to hold you to?";
}

function looksEmotionalGriefContext(raw: string): boolean {
  return /\b(griev(?:e|ing|ed)?|loss of|passed away|died|heartbroken|mourning|funeral|upset with)\b/i.test(
    raw
  );
}

function buildAwaitingCandidateVagueHallwayDraft(raw: string): string {
  if (looksEmotionalGriefContext(raw)) {
    return "I'm sorry. We can change the goal. What is one small thing that would actually help you this week?";
  }
  if (isBroadReplacementDirection(raw)) {
    return buildBroadDirectionHallwayDraft(raw);
  }
  if (isReplacementNotMergeLanguage(raw)) {
    return buildReplacementNotMergeHallwayDraft(raw);
  }
  return "Got it. What new goal do you want me to hold you to?";
}

function buildReplaceConfirmationAskDraft(candidate: string): string {
  return `Do you want your new goal to be: ${candidate.trim()}?`;
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
  // Product law: saved Current Goal replacement always new_chapter (legacy seasonMode ignored).
  void args.seasonMode;
  return applyCanonicalGoalChangeWithSeasonMutation({
    clerkUserId: args.clerkUserId,
    commitment: args.commitment,
    behaviorStatement: args.behaviorStatement,
    seasonMode: "new_chapter",
    idempotencyKey: args.messageSid,
    proofMessageSid: args.messageSid,
    memoryReasonCode: "sms_pending_resolution_replace",
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

  // Keep-current / decline-change while in hallway: clear pending, never mutate, never
  // regress confirmation → awaiting_candidate. Scoped to active pending only.
  if (
    (smsState === "awaiting_candidate" || smsState === "awaiting_confirmation") &&
    isPendingHallwayKeepCurrentClearReply(rawFull)
  ) {
    await clearPendingResolution(c.id, { expectedUpdatedAt: c.updated_at });
    await recomputeV2CoachingMemory(c.id, {
      reasonCode: "sms_pending_resolution_keep_current_cleared",
    });
    logSmsPending({
      pending_resolution_sms_state: "cancelled",
      detected_candidate: null,
      confirmation: "keep_current",
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
      detail: "keep_current_cleared_pending",
    });
    const keepDraft =
      "Got it—we'll stay with your current goal. No change. I'll keep coaching that same standard.";
    return pendingHandled(
      await phase1PendingReply({
        machineDraft: keepDraft,
        brainCase: "pending_resolution_no_problem_reenter",
        allowVictoryRoomPhrase: false,
        currentBarSummary,
        safeFallback: keepDraft,
      }),
      {
        pendingNoSendPolicyBranch: "pending_cleared_no_mutation",
        pendingResolutionKind: kind,
        pendingStateMutatedBeforeSms: true,
        pendingClearedBeforeSms: true,
        pendingStillActiveAfterPhase1: false,
        pendingResolutionApplied: false,
        stateTransitionSummary:
          "User chose keep-current during pending resolution; pending cleared before visible SMS.",
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
      const refined =
        kind === "commitment_replace"
          ? tryMergeWeekdaysIntoCandidate(cand, rawFull)
          : null;
      if (refined && refined !== cand) {
        const mergedDays = await mergeSmsPendingResolutionPayload({
          commitmentId: c.id,
          merge: (prev) => ({
            ...prev,
            sms_state: "awaiting_confirmation",
            candidate_behavior_statement: refined,
            candidate_new_bar: refined,
            raw_user_text: rawFull.slice(0, RAW_LOG_MAX),
            confirmation_prompt_sent_at: new Date().toISOString(),
          }),
        });
        if (mergedDays.ok) {
          const daysAsk = buildReplaceConfirmationAskDraft(refined);
          logSmsPending({
            pending_resolution_sms_state: "awaiting_confirmation",
            detected_candidate: refined,
            confirmation: "prompted",
            mutation_attempted: false,
            mutation_success: false,
            rpc: null,
            old_commitment_id: c.id,
            new_commitment_id: null,
            message_sid: args.job.message_sid,
            raw_text_preview: rawPreview,
            weekday_refine: true,
          });
          return pendingHandled(
            await phase1PendingReply({
              machineDraft: daysAsk,
              brainCase: "pending_resolution_confirmation_prompt",
              allowVictoryRoomPhrase: false,
              currentBarSummary,
              safeFallback: daysAsk,
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
                "Weekday clarification merged into candidate; pending remains awaiting_confirmation before visible SMS.",
            }
          );
        }
      }

      // "Yes, but change it to <concrete>" — keep awaiting_confirmation with the new candidate.
      if (kind === "commitment_replace") {
        const altRaw =
          extractAwaitingCandidateHallwayBar(rawFull) ||
          extractDeterministicDailyBarCandidate(rawFull);
        const altClamped =
          altRaw && !isVagueOrInvalidCandidateBar(altRaw)
            ? clampCandidateForKind(kind, altRaw)
            : null;
        if (altClamped && altClamped.trim().toLowerCase() !== cand.trim().toLowerCase()) {
          const mergedAlt = await mergeSmsPendingResolutionPayload({
            commitmentId: c.id,
            merge: (prev) => ({
              ...prev,
              sms_state: "awaiting_confirmation",
              candidate_behavior_statement: altClamped,
              candidate_new_bar: altClamped,
              raw_user_text: rawFull.slice(0, RAW_LOG_MAX),
              confirmation_prompt_sent_at: new Date().toISOString(),
            }),
          });
          if (mergedAlt.ok) {
            const altAsk = buildReplaceConfirmationAskDraft(altClamped);
            logSmsPending({
              pending_resolution_sms_state: "awaiting_confirmation",
              detected_candidate: altClamped,
              confirmation: "prompted",
              mutation_attempted: false,
              mutation_success: false,
              rpc: null,
              old_commitment_id: c.id,
              new_commitment_id: null,
              message_sid: args.job.message_sid,
              raw_text_preview: rawPreview,
              candidate_refined_on_ambiguous_confirm: true,
            });
            return pendingHandled(
              await phase1PendingReply({
                machineDraft: altAsk,
                brainCase: "pending_resolution_confirmation_prompt",
                allowVictoryRoomPhrase: false,
                currentBarSummary,
                safeFallback: altAsk,
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
                  "Ambiguous confirm offered a concrete alternative; pending remains awaiting_confirmation before visible SMS.",
              }
            );
          }
        }
      }

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
      const ambDraft = buildReplaceConfirmationAskDraft(cand);
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
      // Product law: ignore stored/heuristic season_mode; always new_chapter for saved goal replace.
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
        season_mode: "new_chapter",
        season_mode_requested: seasonResolved.mode,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const rep = await applySmsGoalChangeWithSeasonMutation({
        clerkUserId: args.clerkUserId,
        commitment: c,
        behaviorStatement: cand,
        seasonMode: "new_chapter",
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
          season_mode: "new_chapter",
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
      // Existing new-chapter machine draft (no same-season "Updated bar" path).
      const replaceReply = `Done. New commitment: ${cand}. I’ll hold you to that tomorrow.`;
      let replaceReplyFinal = replaceReply;
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

  let extracted =
    smsState === "awaiting_candidate" && kind === "commitment_replace"
      ? extractAwaitingCandidateHallwayBar(rawFull)
      : extractDeterministicDailyBarCandidate(rawFull);
  if (
    !extracted &&
    smsState === "awaiting_candidate" &&
    kind === "commitment_replace" &&
    isMostlyWeekdayClarification(rawFull)
  ) {
    const priorCand =
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_new_bar?.trim() ||
      "";
    if (priorCand) {
      extracted = tryMergeWeekdaysIntoCandidate(priorCand, rawFull);
    }
  }
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
      kind === "commitment_replace"
        ? buildAwaitingCandidateVagueHallwayDraft(rawFull)
        : "I need one clear daily action. What exactly should I hold you to tomorrow?";
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
  const replacePromptDraft = buildReplaceConfirmationAskDraft(clamped);
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

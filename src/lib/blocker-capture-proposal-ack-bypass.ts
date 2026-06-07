/**
 * P0 Step E — bypass blocker capture for bounded proposal/adjustment acknowledgements.
 * "Good" after "How does committing to X sound?" is plan confirmation, not a blocker name.
 */

import {
  inferPriorQuestionType,
  isBoundedPlanConfirmationAnswer,
  resolveShortAnswerContextAuthority,
  type PriorQuestionType,
  type ShortAnswerContextAuthority,
} from "@/lib/inbound-short-answer-context";
import {
  detectNormalizedShortAnswerPolarity,
  normalizeShortAnswerText,
} from "@/lib/inbound-short-answer-polarity";
import { extractQuestionClausesFromBody } from "@/lib/sms-memory-anti-repeat";

export const PROPOSAL_ADJUSTMENT_PRIOR_COACH_RES: ReadonlyArray<RegExp> = [
  /\bhow does\b.*\bsound\b/i,
  /\bhow do you feel about committing\b/i,
  /\bdoes (this|that|it) adjustment work\b/i,
  /\bshould we adjust\b/i,
  /\bwhat do you think about committing\b/i,
  /\blet's adjust\b.*\bapproach\b/i,
  /\badjust our approach\b/i,
  /\bhow does committing to\b/i,
  /\bdoes (this|that) (plan|approach) work\b/i,
  /\bdoes (this|that)\b.*\b(plan|approach) work\b/i,
  /\bdoes (this|that|it) work\b/i,
  /\bwould you like to adjust\b/i,
];

const BLOCKER_CAPTURE_WHOLE_WORD_RES: ReadonlyArray<RegExp> = [
  /^(time|schedule|scheduling|anxiety|stress|fatigue|tiredness|distraction|distractions|meetings|meeting|work|kids|kid|phone|scrolling|procrastination|forgetfulness)$/i,
];

const BLOCKER_CAPTURE_PHRASE_RES: ReadonlyArray<RegExp> = [
  /\btime got away\b/i,
  /\bgot distracted\b/i,
  /\bget distracted\b/i,
  /\btoo (busy|tired|exhausted|overwhelmed)\b/i,
  /\b(anxiety|anxious|stressed|stressful)\b/i,
  /\bforgot\b/i,
  /\bdidn'?t have time\b/i,
  /\bcouldn'?t find time\b/i,
  /\bschedule (conflict|issue|problem)\b/i,
  /\bgot in the way\b/i,
  /\bwhat blocked\b/i,
  /\bbecause of work\b/i,
  /\bi got distracted\b/i,
];

export function looksLikeProposalOrAdjustmentCoachMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PROPOSAL_ADJUSTMENT_PRIOR_COACH_RES.some((rx) => rx.test(t))) return true;
  return inferPriorQuestionType({
    rawInbound: "yes",
    latestOpenQuestion: t,
    latestOutboundBody: t,
  }) === "plan_confirmation";
}

export function inboundContainsRealBlockerCaptureSignal(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const { normalized } = normalizeShortAnswerText(trimmed);
  const lower = trimmed.toLowerCase();

  if (BLOCKER_CAPTURE_WHOLE_WORD_RES.some((rx) => rx.test(normalized))) return true;
  if (BLOCKER_CAPTURE_PHRASE_RES.some((rx) => rx.test(lower))) return true;

  if (/\b(distracted|distraction|forgot|couldn'?t|could not|didn'?t have time)\b/i.test(lower)) {
    return true;
  }

  return false;
}

export function isPureBoundedProposalAcknowledgement(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (inboundContainsRealBlockerCaptureSignal(trimmed)) return false;

  const lead = trimmed.split(/[,;]/)[0]?.trim() ?? trimmed;
  if (isBoundedPlanConfirmationAnswer(lead)) return true;

  const { normalized } = normalizeShortAnswerText(lead);
  if (/^(good|fine|great|perfect|perfecto)$/.test(normalized)) return true;

  return detectNormalizedShortAnswerPolarity(lead) === "affirm" && lead.length <= 32;
}

/** Proposal/adjustment/plan-confirmation only — not open reflection or recovery asks. */
function isProposalAckPriorType(priorType: PriorQuestionType): boolean {
  return priorType === "plan_confirmation" || priorType === "adjustment_prompt";
}

export function shouldBypassBlockerCaptureForProposalAck(args: {
  rawInbound: string;
  latestOutboundBody?: string | null;
  latestOpenQuestion?: string | null;
  expectedAnswerType?: string | null;
  expectedReplySemantics?: string | null;
  openQuestionPending?: boolean;
}): { bypass: boolean; reason: string | null; saca: ShortAnswerContextAuthority } {
  const raw = args.rawInbound.trim();
  const coachText =
    args.latestOpenQuestion?.trim() ||
    extractQuestionClausesFromBody(args.latestOutboundBody ?? "").slice(-1)[0]?.trim() ||
    args.latestOutboundBody?.trim() ||
    "";

  const saca = resolveShortAnswerContextAuthority({
    rawInbound: raw,
    latestOutboundBody: args.latestOutboundBody,
    latestOpenQuestion: (args.latestOpenQuestion ?? coachText) || null,
    expectedAnswerType: args.expectedAnswerType,
    expectedReplySemantics: args.expectedReplySemantics,
    openQuestionPending: args.openQuestionPending,
  });

  if (!raw) return { bypass: false, reason: "empty_inbound", saca };
  if (inboundContainsRealBlockerCaptureSignal(raw)) {
    return { bypass: false, reason: "blocker_signal_present", saca };
  }
  if (!isPureBoundedProposalAcknowledgement(raw)) {
    return { bypass: false, reason: "not_bounded_proposal_ack", saca };
  }
  if (saca.prior_question_type === "outcome_check") {
    return { bypass: false, reason: "outcome_check_prior", saca };
  }
  if (saca.outcome_proof_eligible) {
    return { bypass: false, reason: "outcome_proof_eligible", saca };
  }

  const proposalShapedPrior =
    looksLikeProposalOrAdjustmentCoachMessage(coachText) ||
    isProposalAckPriorType(saca.prior_question_type);

  if (!proposalShapedPrior) {
    return { bypass: false, reason: `prior_${saca.prior_question_type}`, saca };
  }

  if (
    saca.response_intent_hint === "acknowledge_plan_confirmation" ||
    (saca.short_answer_polarity === "affirm" && saca.allowed_persistence === "no_outcome_write") ||
    (saca.prior_question_type === "plan_confirmation" && saca.short_answer_polarity === "affirm")
  ) {
    return { bypass: true, reason: saca.reason, saca };
  }

  if (
    looksLikeProposalOrAdjustmentCoachMessage(coachText) &&
    (saca.short_answer_polarity === "affirm" || isPureBoundedProposalAcknowledgement(raw))
  ) {
    return { bypass: true, reason: "proposal_shaped_prior_bounded_ack", saca };
  }

  return { bypass: false, reason: "no_proposal_ack_match", saca };
}

export function extractLatestCoachQuestionFromOutboundBody(body: string | null | undefined): string | null {
  const t = body?.trim();
  if (!t) return null;
  const clauses = extractQuestionClausesFromBody(t);
  if (clauses.length) return clauses[clauses.length - 1]!.trim();
  return t;
}

/**
 * P0 Step F — block rapid near-duplicate coach replies after short acknowledgements.
 */

import { isPureBoundedProposalAcknowledgement } from "@/lib/blocker-capture-proposal-ack-bypass";
import { isBoundedPlanConfirmationAnswer } from "@/lib/inbound-short-answer-context";
import { normalizeShortAnswerText } from "@/lib/inbound-short-answer-polarity";
import {
  extractQuestionClausesFromBody,
  isNearExactDuplicateSms,
  normalizeSmsMemoryRepeatText,
} from "@/lib/sms-memory-anti-repeat";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";

export const RAPID_NEAR_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const RAPID_NEAR_DUPLICATE_REPLY_NO_SEND = "rapid_near_duplicate_reply_blocked" as const;

export type NearDuplicateReason =
  | "exact_duplicate"
  | "near_exact_duplicate"
  | "short_ack_repeated_proposal"
  | "rapid_same_question"
  | "not_duplicate"
  | "inactive_no_prior"
  | "inactive_outside_window"
  | "inactive_same_as_candidate";

export type NearDuplicateDetectionResult = {
  is_near_duplicate: boolean;
  reason: NearDuplicateReason;
  within_recency_window: boolean;
  short_ack_inbound: boolean;
};

const CONTENT_TOKEN_STOPWORDS = new Set([
  "what",
  "when",
  "which",
  "who",
  "how",
  "your",
  "the",
  "this",
  "that",
  "with",
  "about",
  "today",
  "will",
  "have",
  "been",
  "from",
  "they",
  "their",
  "just",
  "after",
  "before",
  "does",
  "could",
  "would",
  "should",
  "feel",
  "sound",
  "like",
  "that",
  "did",
  "you",
  "are",
  "was",
  "for",
  "and",
  "but",
  "our",
  "per",
  "day",
]);

const PROPOSAL_SHAPE_RES: ReadonlyArray<RegExp> = [
  /\bhow does committing to\b/i,
  /\bhow do you feel about committing\b/i,
  /\bwhat do you think about committing\b/i,
  /\badjust our approach\b/i,
  /\blet'?s adjust our approach\b/i,
  /\bshould we adjust\b/i,
  /\bwould you like to adjust\b/i,
  /\bdoes (this|that|it) (plan|approach) work\b/i,
  /\bhow does\b.*\bsound\b/i,
];

const BARRIER_RECOVERY_QUESTION_RE =
  /\bwhat (got in the way|blocked|blocked you|led to that|happened)\b/i;

const LOOP_CLOSE_ACK_RE =
  /\b(good|got it|sure|okay|ok|fine|perfect|great)\b[^.!?]{0,40}\b(keep|plan|place|there|locked|clear|works)\b/i;

function parseIsoMs(iso?: string | null): number {
  if (!iso?.trim()) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function contentTokens(text: string): string[] {
  return normalizeSmsMemoryRepeatText(text)
    .split(" ")
    .filter((w) => w.length > 3 && !CONTENT_TOKEN_STOPWORDS.has(w));
}

function contentTokenJaccard(a: string, b: string): number {
  const aTokens = contentTokens(a);
  const bTokens = new Set(contentTokens(b));
  if (!aTokens.length || !bTokens.size) return 0;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter += 1;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? inter / union : 0;
}

function wordOverlapRatio(a: string, b: string): number {
  const aWords = normalizeSmsMemoryRepeatText(a)
    .split(" ")
    .filter((w) => w.length > 3);
  const bWords = new Set(
    normalizeSmsMemoryRepeatText(b)
      .split(" ")
      .filter((w) => w.length > 3)
  );
  if (!aWords.length || !bWords.size) return 0;
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap += 1;
  return overlap / aWords.length;
}

export function isInboundShortAckOrPlanConfirmation(rawInbound: string): boolean {
  const raw = rawInbound.trim();
  if (!raw) return false;
  if (isPureBoundedProposalAcknowledgement(raw)) return true;
  if (isBoundedPlanConfirmationAnswer(raw)) return true;
  const lead = raw.split(/[,;]/)[0]?.trim() ?? raw;
  const { normalized } = normalizeShortAnswerText(lead);
  if (/^(will do|got it|works for me|sure thing)$/.test(normalized)) return true;
  return false;
}

export function isBriefLoopClosingCoachReply(body: string): boolean {
  const t = body.trim();
  if (!t || /\?/.test(t)) return false;
  if (PROPOSAL_SHAPE_RES.some((rx) => rx.test(t))) return false;
  if (BARRIER_RECOVERY_QUESTION_RE.test(t) && t.length > 40) return false;
  return LOOP_CLOSE_ACK_RE.test(t);
}

function hasProposalShape(text: string): boolean {
  return PROPOSAL_SHAPE_RES.some((rx) => rx.test(text));
}

function extractCommitmentTargetPhrase(text: string): string | null {
  const m =
    text.match(/\bcommitting to ([^.?!]{8,80})/i) ??
    text.match(/\bcommit to ([^.?!]{8,80})/i);
  return m?.[1]?.trim() ?? null;
}

function sameCommitmentTargetPhrase(a: string, b: string): boolean {
  const ta = extractCommitmentTargetPhrase(a);
  const tb = extractCommitmentTargetPhrase(b);
  if (!ta || !tb) return false;
  return wordOverlapRatio(ta, tb) >= 0.55 || normalizeSmsMemoryRepeatText(ta).includes(normalizeSmsMemoryRepeatText(tb).slice(0, 20));
}

function isBarrierRecoveryQuestion(text: string): boolean {
  return BARRIER_RECOVERY_QUESTION_RE.test(text.trim());
}

function isOutcomeCloseQuestionWithTarget(text: string): boolean {
  return /\bdid (the|that|your|you)\b/i.test(text) && /\?/.test(text);
}

function sameOutcomeCloseTarget(a: string, b: string): boolean {
  const aNorm = normalizeSmsMemoryRepeatText(a);
  const bNorm = normalizeSmsMemoryRepeatText(b);
  const proper = (s: string): string[] => {
    const m = s.match(/\b(bond|[A-Z][a-z]+)\b/g);
    return m ?? [];
  };
  const aNames = proper(a);
  const bNames = proper(b);
  if (aNames.length && bNames.length && aNames.some((n) => bNames.includes(n))) {
    return wordOverlapRatio(aNorm, bNorm) >= 0.45;
  }
  return wordOverlapRatio(aNorm, bNorm) >= 0.72;
}

function isMateriallyDifferentFollowUp(args: {
  priorCoachBody: string;
  candidateBody: string;
  inboundRaw: string;
}): boolean {
  const inbound = args.inboundRaw.trim();
  if (!inbound || isInboundShortAckOrPlanConfirmation(inbound)) return false;

  const prior = args.priorCoachBody.trim();
  const candidate = args.candidateBody.trim();

  if (hasProposalShape(prior) && !hasProposalShape(candidate)) {
    if (/\b(time|blocked|blocker|busy|distract|schedule)\b/i.test(inbound)) return true;
  }

  if (isOutcomeCloseQuestionWithTarget(prior)) {
    if (/\b(yes|talked|spoke|happened|did)\b/i.test(inbound) && /\bwhat came out\b/i.test(candidate)) {
      return true;
    }
  }

  if (/\bdid you do\b/i.test(prior) && isBarrierRecoveryQuestion(candidate)) {
    return true;
  }

  return false;
}

export function resolvePriorCoachContextFromMemoryPacket(args: {
  memoryPacket?: {
    last_outbound_full_body?: string | null;
    recent_exact_thread_72h?: RecentExactThread72hResult | null;
  } | null;
  fallbackPriorBody?: string | null;
  fallbackPriorSentAt?: string | null;
}): { priorCoachBody: string | null; priorCoachSentAt: string | null } {
  let priorCoachBody = args.memoryPacket?.last_outbound_full_body?.trim() || null;
  let priorCoachSentAt: string | null = null;

  const messages = args.memoryPacket?.recent_exact_thread_72h?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "coach" || !m.body?.trim()) continue;
    if (!priorCoachBody) priorCoachBody = m.body.trim();
    priorCoachSentAt = m.at ?? null;
    if (priorCoachBody === m.body.trim()) break;
  }

  if (!priorCoachBody && args.fallbackPriorBody?.trim()) {
    priorCoachBody = args.fallbackPriorBody.trim();
    priorCoachSentAt = args.fallbackPriorSentAt ?? null;
  }

  return { priorCoachBody, priorCoachSentAt };
}

export function detectRapidNearDuplicateCoachReply(args: {
  candidateBody: string;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  inboundRaw?: string | null;
  nowMs?: number;
}): NearDuplicateDetectionResult {
  const candidate = args.candidateBody.trim();
  const prior = args.priorCoachBody?.trim() ?? "";
  const inboundRaw = args.inboundRaw?.trim() ?? "";

  if (!candidate || !prior) {
    return {
      is_near_duplicate: false,
      reason: "inactive_no_prior",
      within_recency_window: false,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  if (normalizeSmsMemoryRepeatText(candidate) === normalizeSmsMemoryRepeatText(prior)) {
    return {
      is_near_duplicate: true,
      reason: "exact_duplicate",
      within_recency_window: true,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  if (isBriefLoopClosingCoachReply(candidate)) {
    return {
      is_near_duplicate: false,
      reason: "not_duplicate",
      within_recency_window: false,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  if (isMateriallyDifferentFollowUp({ priorCoachBody: prior, candidateBody: candidate, inboundRaw })) {
    return {
      is_near_duplicate: false,
      reason: "not_duplicate",
      within_recency_window: false,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  const nowMs = args.nowMs ?? Date.now();
  const priorMs = parseIsoMs(args.priorCoachSentAt);
  const withinWindow =
    priorMs > 0 ? nowMs - priorMs <= RAPID_NEAR_DUPLICATE_WINDOW_MS : false;

  if (isNearExactDuplicateSms(candidate, prior)) {
    return {
      is_near_duplicate: withinWindow || priorMs === 0,
      reason: "near_exact_duplicate",
      within_recency_window: withinWindow,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  if (!withinWindow) {
    return {
      is_near_duplicate: false,
      reason: "inactive_outside_window",
      within_recency_window: false,
      short_ack_inbound: isInboundShortAckOrPlanConfirmation(inboundRaw),
    };
  }

  const shortAck = isInboundShortAckOrPlanConfirmation(inboundRaw);

  if (
    shortAck &&
    hasProposalShape(prior) &&
    hasProposalShape(candidate) &&
    (sameCommitmentTargetPhrase(prior, candidate) || contentTokenJaccard(prior, candidate) >= 0.45)
  ) {
    return {
      is_near_duplicate: true,
      reason: "short_ack_repeated_proposal",
      within_recency_window: true,
      short_ack_inbound: true,
    };
  }

  const priorQuestions = extractQuestionClausesFromBody(prior);
  const candidateQuestions = extractQuestionClausesFromBody(candidate);

  if (shortAck && isBarrierRecoveryQuestion(prior) && isBarrierRecoveryQuestion(candidate)) {
    return {
      is_near_duplicate: true,
      reason: "rapid_same_question",
      within_recency_window: true,
      short_ack_inbound: true,
    };
  }

  if (
    shortAck &&
    priorQuestions.length > 0 &&
    candidateQuestions.length > 0 &&
    priorQuestions.some((pq) =>
      candidateQuestions.some((cq) => wordOverlapRatio(pq, cq) >= 0.45 || contentTokenJaccard(pq, cq) >= 0.5)
    ) &&
    (hasProposalShape(prior) || isOutcomeCloseQuestionWithTarget(prior) || isBarrierRecoveryQuestion(prior))
  ) {
    if (isOutcomeCloseQuestionWithTarget(prior) && isOutcomeCloseQuestionWithTarget(candidate)) {
      if (sameOutcomeCloseTarget(prior, candidate)) {
        return {
          is_near_duplicate: true,
          reason: "rapid_same_question",
          within_recency_window: true,
          short_ack_inbound: true,
        };
      }
    } else {
      return {
        is_near_duplicate: true,
        reason: "rapid_same_question",
        within_recency_window: true,
        short_ack_inbound: true,
      };
    }
  }

  if (contentTokenJaccard(prior, candidate) >= 0.62 && (hasProposalShape(prior) || hasProposalShape(candidate))) {
    return {
      is_near_duplicate: shortAck,
      reason: shortAck ? "short_ack_repeated_proposal" : "not_duplicate",
      within_recency_window: true,
      short_ack_inbound: shortAck,
    };
  }

  return {
    is_near_duplicate: false,
    reason: "not_duplicate",
    within_recency_window: withinWindow,
    short_ack_inbound: shortAck,
  };
}

export type ApplyRapidNearDuplicateCoachReplyGuardArgs = {
  body: string;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  inboundRaw?: string | null;
  nowMs?: number;
  routePurpose?: string | null;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: import("@/lib/sms-relationship-repair-snapshot-v1").RepairRelationshipSnapshotV1 | null;
  stage?: string;
};

export type RapidNearDuplicateCoachReplyGuardResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: typeof RAPID_NEAR_DUPLICATE_REPLY_NO_SEND | null;
  detection: NearDuplicateDetectionResult;
  metadata: Record<string, unknown>;
};

export async function applyRapidNearDuplicateCoachReplyGuard(
  args: ApplyRapidNearDuplicateCoachReplyGuardArgs
): Promise<RapidNearDuplicateCoachReplyGuardResult> {
  const stage = args.stage ?? "rapid_near_duplicate_guard";
  const baseMeta: Record<string, unknown> = {
    rapid_near_duplicate_guard_ran: true,
    rapid_near_duplicate_guard_stage: stage,
  };

  const detection = detectRapidNearDuplicateCoachReply({
    candidateBody: args.body,
    priorCoachBody: args.priorCoachBody,
    priorCoachSentAt: args.priorCoachSentAt,
    inboundRaw: args.inboundRaw,
    nowMs: args.nowMs,
  });

  baseMeta.near_duplicate_detection = detection;
  baseMeta.prior_coach_body_preview = args.priorCoachBody?.trim().slice(0, 120) ?? null;

  if (!detection.is_near_duplicate) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      detection,
      metadata: {
        ...baseMeta,
        rapid_near_duplicate_violation_detected: false,
      },
    };
  }

  const { repairV3RelationshipLaneBodyWithOpenAI } = await import("@/lib/v3-sms-voice-ownership");
  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: args.routePurpose ?? "rapid_near_duplicate_reply_guard",
    originalBody: args.body,
    blockedReasons: ["rapid_near_duplicate_coach_reply"],
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    systemInstruction:
      "NEAR-DUPLICATE GUARD: Do not repeat the previous coach message. The user already heard that. " +
      "Acknowledge their latest reply and move forward or close the loop briefly. " +
      "Do not re-ask the same proposal or question in different words. " +
      "No fake proof. No outcome claims. No internal labels. No hard-coded templates. One short SMS.",
  });

  if (repair?.body?.trim()) {
    const repaired = repair.body.trim();
    const recheck = detectRapidNearDuplicateCoachReply({
      candidateBody: repaired,
      priorCoachBody: args.priorCoachBody,
      priorCoachSentAt: args.priorCoachSentAt,
      inboundRaw: args.inboundRaw,
      nowMs: args.nowMs,
    });
    if (!recheck.is_near_duplicate) {
      return {
        body: repaired,
        shouldSend: true,
        noSendReason: null,
        detection: recheck,
        metadata: {
          ...baseMeta,
          rapid_near_duplicate_violation_detected: true,
          rapid_near_duplicate_original_reason: detection.reason,
          rapid_near_duplicate_repair_attempted: true,
          rapid_near_duplicate_repair_succeeded: true,
          rapid_near_duplicate_repair_metadata: repair.metadata,
        },
      };
    }
  }

  return {
    body: "",
    shouldSend: false,
    noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
    detection,
    metadata: {
      ...baseMeta,
      rapid_near_duplicate_violation_detected: true,
      rapid_near_duplicate_original_reason: detection.reason,
      rapid_near_duplicate_repair_attempted: Boolean(repair),
      rapid_near_duplicate_repair_succeeded: false,
      rapid_near_duplicate_no_send_reason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
    },
  };
}

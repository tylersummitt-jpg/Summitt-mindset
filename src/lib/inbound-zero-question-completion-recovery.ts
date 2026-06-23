/**
 * Zero-question completion recovery — statement repair + last-resort ack when proof already persisted.
 * Narrow scope: acknowledge_completion + max_questions_override=0 + user_yes pre-writer persist.
 */

import type {
  InboundResolvedTruth,
  InboundV3RelationshipFacts,
  InboundV3RelationshipLaneInput,
} from "@/lib/v3-inbound-relationship-lane";
import { classifyInboundSmsSafetyTier } from "@/lib/sms-inbound-safety";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

const ZERO_QUESTION_ASK_SHAPED_RE =
  /\b(did you|do you|have you|will you|can you|what proof|what evidence|how did it go|what got in the way|what small step|what's next|what is next|how are you feeling|what did you experience|what does .{0,40} look like|how did it feel|what helped)\b/i;

const FAKE_PRAISE_RE =
  /\b(great commitment|shown commitment|great job|good job|nice work|proud of you|keep momentum|you'?ve got this|reply yes|reply no)\b/i;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

export type ZeroQuestionCompletionRecoveryResult =
  | { ok: true; body: string; telemetry: ZeroQuestionCompletionRecoveryTelemetry }
  | { ok: false; telemetry: ZeroQuestionCompletionRecoveryTelemetry };

export type ZeroQuestionCompletionRecoveryTelemetry = {
  zero_question_repair_attempted: boolean;
  zero_question_repair_succeeded?: boolean;
  zero_question_completion_fallback_used?: boolean;
  zero_question_completion_fallback_reason?: string | null;
  proof_persisted_before_zero_question_fallback?: boolean;
  final_reply_source?: "zero_question_repair" | "zero_question_completion_fallback";
  zero_question_blocked_candidate_preview?: string;
};

function bodyPassesZeroQuestionRules(body: string, rt: InboundResolvedTruth | null | undefined): boolean {
  if (!rt || rt.max_questions_override !== 0) return true;
  const b = body.trim();
  if (!b) return false;
  if (/\?/.test(b)) return false;
  if (ZERO_QUESTION_ASK_SHAPED_RE.test(b)) return false;
  return true;
}

function cappedPreview(text: string): string {
  const t = text.trim();
  return t.length > 220 ? `${t.slice(0, 219)}…` : t;
}

function sentenceViolatesZeroQuestionRules(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return true;
  if (/\?/.test(s)) return true;
  if (ZERO_QUESTION_ASK_SHAPED_RE.test(s)) return true;
  return false;
}

function statementPassesRecoveryQualityGate(statement: string): boolean {
  const t = statement.trim();
  if (t.length < 8) return false;
  if (FAKE_PRAISE_RE.test(t)) return false;
  if (/\b(reply\s+yes|reply\s+no)\b/i.test(t)) return false;
  return true;
}

/** Strip ask-shaped sentences; keep first clean statement. */
export function repairZeroQuestionCompletionStatement(candidate: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;

  const parts = raw
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = parts.length > 0 ? parts : [raw];

  for (const part of candidates) {
    if (sentenceViolatesZeroQuestionRules(part)) continue;
    let statement = part.replace(/\s+/g, " ").trim();
    statement = statement.replace(/^(great|good|nice)\s+job[,!\s-]*/i, "");
    statement = statement.replace(/^(well done|proud of you)[,!\s-]*/i, "");
    if (statement.length > 0) {
      statement = statement.charAt(0).toUpperCase() + statement.slice(1);
    }
    statement = statement.replace(/[!]+$/g, ".").replace(/[?]+$/g, "");
    if (!statement.endsWith(".")) statement = `${statement}.`;
    if (!statementPassesRecoveryQualityGate(statement)) continue;
    return statement;
  }

  const beforeQuestion = raw.split(/\?/)[0]?.trim();
  if (beforeQuestion && beforeQuestion.length >= 8 && !sentenceViolatesZeroQuestionRules(beforeQuestion)) {
    let statement = beforeQuestion.replace(/\s+/g, " ").trim();
    if (!statement.endsWith(".")) statement = `${statement}.`;
    if (statementPassesRecoveryQualityGate(statement)) return statement;
  }

  return null;
}

function extractStepMetricHint(userText: string, commitmentBlob: string): "10000_steps" | "steps" | null {
  const blob = `${userText} ${commitmentBlob}`.toLowerCase();
  if (/\b10,?000\s+steps\b/.test(blob) || /\bten\s+thousand\s+steps\b/.test(blob)) {
    return "10000_steps";
  }
  if (/\bsteps\b/.test(blob) && /\b(walk|step)/.test(blob)) {
    return "steps";
  }
  return null;
}

/** One-sentence factual acknowledgement — no questions, no fake praise. */
export function buildZeroQuestionCompletionFallbackAck(
  facts: InboundV3RelationshipFacts
): string | null {
  const userText = facts.thread.coalesced_inbound_text?.trim() ?? "";
  const commitmentBlob = [
    facts.commitment.behavior_statement,
    facts.commitment.effective_ask,
    facts.commitment.title,
  ]
    .filter(Boolean)
    .join(" ");

  const stepHint = extractStepMetricHint(userText, commitmentBlob);
  if (stepHint === "10000_steps") {
    return "That counts — 10,000 steps today.";
  }
  if (stepHint === "steps") {
    return "You got the steps in. That is today's win.";
  }
  if (/\b(steps?|walk(?:ing)?|mile)\b/i.test(commitmentBlob)) {
    return "Good — the step goal is handled for today.";
  }
  return "That counts — today's goal is handled.";
}

export function isAcknowledgeCompletionZeroQuestionRecoveryEligible(
  args: InboundV3RelationshipLaneInput
): boolean {
  const rt = args.facts.inbound_resolved_truth;
  if (!rt || rt.max_questions_override !== 0) return false;
  if (rt.required_reply_move !== "acknowledge_completion") return false;
  if (args.proof_persisted_before_writer !== true) return false;
  if (args.proof_persisted_event_type !== "user_yes") return false;

  if (args.facts.goal_change_facts?.goal_change_intent_detected) return false;

  const raw = args.facts.thread.coalesced_inbound_text?.trim() ?? "";
  if (!raw) return false;
  if (isLikelySmsComplianceOrOptOutTurn(raw)) return false;
  const safety = classifyInboundSmsSafetyTier(raw);
  if (safety.tier === "crisis" || safety.tier === "harmful_request") return false;

  return true;
}

export function tryRecoverAcknowledgeCompletionZeroQuestionBody(
  candidate: string,
  args: InboundV3RelationshipLaneInput,
  validateBody: (body: string) => boolean
): ZeroQuestionCompletionRecoveryResult {
  const baseTelemetry: ZeroQuestionCompletionRecoveryTelemetry = {
    zero_question_repair_attempted: false,
    zero_question_blocked_candidate_preview: cappedPreview(candidate),
  };

  if (!isAcknowledgeCompletionZeroQuestionRecoveryEligible(args)) {
    return { ok: false, telemetry: baseTelemetry };
  }

  const rt = args.facts.inbound_resolved_truth!;
  const telemetry: ZeroQuestionCompletionRecoveryTelemetry = {
    ...baseTelemetry,
    zero_question_repair_attempted: true,
    proof_persisted_before_zero_question_fallback: true,
  };

  const repaired = repairZeroQuestionCompletionStatement(candidate);
  if (repaired) {
    if (bodyPassesZeroQuestionRules(repaired, rt) && validateBody(repaired)) {
      return {
        ok: true,
        body: repaired,
        telemetry: {
          ...telemetry,
          zero_question_repair_succeeded: true,
          zero_question_completion_fallback_used: false,
          final_reply_source: "zero_question_repair",
        },
      };
    }
  }

  const fallback = buildZeroQuestionCompletionFallbackAck(args.facts);
  if (fallback) {
    if (bodyPassesZeroQuestionRules(fallback, rt) && validateBody(fallback)) {
      return {
        ok: true,
        body: fallback,
        telemetry: {
          ...telemetry,
          zero_question_repair_succeeded: false,
          zero_question_completion_fallback_used: true,
          zero_question_completion_fallback_reason: repaired ? "statement_repair_failed_validation" : "statement_repair_empty",
          final_reply_source: "zero_question_completion_fallback",
        },
      };
    }
  }

  return {
    ok: false,
    telemetry: {
      ...telemetry,
      zero_question_repair_succeeded: false,
      zero_question_completion_fallback_used: false,
      zero_question_completion_fallback_reason: "recovery_validation_failed",
    },
  };
}

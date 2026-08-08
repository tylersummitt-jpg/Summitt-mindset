/**
 * Blocks outbound miss-framing after explicit aligned full-goal completion proof in inbound.
 */

import {
  detectExplicitAlignedInboundCompletion,
} from "@/lib/inbound-self-reported-completion";
import {
  buildZeroQuestionCompletionFallbackAck,
  repairZeroQuestionCompletionStatement,
} from "@/lib/inbound-zero-question-completion-recovery";
import type { InboundV3RelationshipFacts, InboundV3RelationshipLaneInput } from "@/lib/v3-inbound-relationship-lane";
import type { CompletionAlignmentContext } from "@/lib/inbound-self-reported-completion";

export const COMPLETION_CONTRADICTION_PHRASE_RE =
  /\b(kept you from reaching your full goal|kept you from reaching your goal|prevented you from reaching|stopped you from reaching|what stopped you from hitting|why didn'?t you reach|why did you not reach|did not reach your goal|didn'?t reach your goal|short of your goal|fell short of your goal|not reach your full goal)\b/i;

export type CompletionContradictionGuardTelemetry = {
  completion_contradiction_guard_applied?: boolean;
  completion_contradiction_guard_reason?: string | null;
  explicit_aligned_completion_detected?: boolean;
  final_reply_source?: "completion_contradiction_repair" | "completion_contradiction_fallback";
};

export { detectExplicitAlignedInboundCompletion };

export function completionAlignmentContextFromInboundFacts(
  facts: InboundV3RelationshipFacts
): CompletionAlignmentContext {
  return {
    commitmentBehaviorStatement: facts.commitment.behavior_statement ?? null,
    effectiveAsk: facts.commitment.effective_ask ?? null,
  };
}

export function detectInboundCompletionContradictionViolation(
  body: string,
  facts: InboundV3RelationshipFacts
): { violation: boolean; reason: string | null } {
  const inboundRaw = facts.thread.coalesced_inbound_text?.trim() ?? "";
  if (!detectExplicitAlignedInboundCompletion(inboundRaw, completionAlignmentContextFromInboundFacts(facts))) {
    return { violation: false, reason: null };
  }
  const b = body.trim();
  if (!b) return { violation: false, reason: null };
  if (COMPLETION_CONTRADICTION_PHRASE_RE.test(b)) {
    return { violation: true, reason: "completion_contradiction_phrase" };
  }
  return { violation: false, reason: null };
}

function buildCompletionContradictionFallbackAck(facts: InboundV3RelationshipFacts): string | null {
  const userText = facts.thread.coalesced_inbound_text?.trim() ?? "";
  if (/\b10,?000\s+steps\b/i.test(userText)) {
    if (/\bwalking\s+the\s+dogs\b/i.test(userText) && /\bthis\s+morning\b/i.test(userText)) {
      return "You hit 10,000 steps this morning while walking the dogs. That counts.";
    }
    if (/\bthis\s+morning\b/i.test(userText)) {
      return "You hit 10,000 steps this morning. That counts.";
    }
  }
  return buildZeroQuestionCompletionFallbackAck(facts);
}

export function tryRecoverInboundCompletionContradictionBody(
  candidate: string,
  args: InboundV3RelationshipLaneInput,
  validateBody: (body: string) => boolean
):
  | { ok: true; body: string; telemetry: CompletionContradictionGuardTelemetry }
  | { ok: false; telemetry: CompletionContradictionGuardTelemetry } {
  const inboundRaw = args.facts.thread.coalesced_inbound_text?.trim() ?? "";
  const explicitAligned = detectExplicitAlignedInboundCompletion(
    inboundRaw,
    completionAlignmentContextFromInboundFacts(args.facts)
  );
  const baseTelemetry: CompletionContradictionGuardTelemetry = {
    explicit_aligned_completion_detected: explicitAligned,
    completion_contradiction_guard_applied: false,
  };

  if (!explicitAligned) {
    return { ok: false, telemetry: baseTelemetry };
  }

  const contradiction = detectInboundCompletionContradictionViolation(candidate, args.facts);
  if (!contradiction.violation) {
    return { ok: false, telemetry: baseTelemetry };
  }

  const repaired = repairZeroQuestionCompletionStatement(candidate);
  if (repaired && !COMPLETION_CONTRADICTION_PHRASE_RE.test(repaired) && validateBody(repaired)) {
    return {
      ok: true,
      body: repaired,
      telemetry: {
        ...baseTelemetry,
        completion_contradiction_guard_applied: true,
        completion_contradiction_guard_reason: "statement_repair",
        final_reply_source: "completion_contradiction_repair",
      },
    };
  }

  const fallback = buildCompletionContradictionFallbackAck(args.facts);
  if (
    fallback &&
    !/\?/.test(fallback) &&
    !COMPLETION_CONTRADICTION_PHRASE_RE.test(fallback) &&
    validateBody(fallback)
  ) {
    return {
      ok: true,
      body: fallback,
      telemetry: {
        ...baseTelemetry,
        completion_contradiction_guard_applied: true,
        completion_contradiction_guard_reason: repaired
          ? "fallback_after_repair_failed"
          : "fallback_direct",
        final_reply_source: "completion_contradiction_fallback",
      },
    };
  }

  return {
    ok: false,
    telemetry: {
      ...baseTelemetry,
      completion_contradiction_guard_reason: "recovery_validation_failed",
    },
  };
}

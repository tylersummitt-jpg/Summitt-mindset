/**
 * Explicit / SACA-authorized server-safe outcome persistence when visible inbound reply no-sends.
 */

import type { ShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { resolveShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { inboundExplicitOutcomeDetected } from "@/lib/inbound-short-answer-clauses";
import {
  persistenceDecisionToOutcomeEventType,
  type InboundMeaningFacts,
} from "@/lib/inbound-relationship-meaning";
import type { InboundOutcomePersistResult } from "@/lib/v2-inbound-accountability-outcome-persist";

export type NoSendOutcomePersistTelemetryContext = {
  shortAnswerContext?: ShortAnswerContextAuthority | null;
  inboundMeaning?: InboundMeaningFacts | null;
  noSendReason?: string | null;
};

export function isShortAnswerOutcomeAuthorizedForPersist(
  userMessage: string,
  context?: NoSendOutcomePersistTelemetryContext
): boolean {
  const saca =
    context?.shortAnswerContext ??
    (context?.inboundMeaning
      ? null
      : resolveShortAnswerContextAuthority({ rawInbound: userMessage }));
  if (!saca) {
    const meaning = context?.inboundMeaning;
    if (
      meaning?.persistence_decision &&
      meaning.persistence_decision !== "no_outcome_write" &&
      meaning.persistence_decision !== "ack_only" &&
      !meaning.persistence_decision.startsWith("defer_")
    ) {
      return persistenceDecisionToOutcomeEventType(meaning.persistence_decision) != null;
    }
    return false;
  }
  return (
    saca.outcome_proof_eligible === true &&
    saca.allowed_persistence !== "no_outcome_write"
  );
}

export function shouldAttemptNoSendOutcomePersist(
  userMessage: string,
  context?: NoSendOutcomePersistTelemetryContext
): boolean {
  if (inboundExplicitOutcomeDetected(userMessage)) return true;
  return isShortAnswerOutcomeAuthorizedForPersist(userMessage, context);
}

export function buildInboundTruthPersistOutcomeTelemetry(
  persistResult: InboundOutcomePersistResult,
  args: {
    stage: "before_writer" | "on_no_send";
    persistenceDecision?: string | null;
    noSendReason?: string | null;
  }
): Record<string, unknown> {
  const persisted =
    persistResult.status === "inserted" || persistResult.status === "duplicate";
  const attempted = true;
  const base: Record<string, unknown> = {
    inbound_truth_persist_stage: args.stage,
    ...(args.persistenceDecision != null
      ? { persistence_decision_at_no_send: args.persistenceDecision }
      : {}),
    ...(args.noSendReason != null ? { inbound_reply_no_send_reason: args.noSendReason } : {}),
    ...(persistResult.status === "skipped"
      ? { inbound_truth_persist_skipped_reason: persistResult.skipReason }
      : {}),
    ...(persisted
      ? {
          inbound_truth_persist_event_type: persistResult.eventType,
          ...(persistResult.status === "inserted"
            ? { inbound_truth_persist_event_id: persistResult.eventId }
            : {}),
        }
      : {}),
  };

  if (args.stage === "before_writer") {
    return {
      ...base,
      inbound_truth_persist_attempted_before_writer: attempted,
      inbound_truth_persist_succeeded_before_writer: persisted,
    };
  }

  return {
    ...base,
    inbound_truth_persist_attempted_on_no_send: attempted,
    inbound_truth_persist_succeeded_on_no_send: persisted,
  };
}

export function buildExplicitOutcomeBeforeNoSendTelemetry(
  userMessage: string,
  persistResult: InboundOutcomePersistResult,
  context?: NoSendOutcomePersistTelemetryContext & {
    persistenceDecision?: string | null;
    noSendReason?: string | null;
  }
): Record<string, unknown> {
  const saca =
    context?.shortAnswerContext ??
    resolveShortAnswerContextAuthority({ rawInbound: userMessage });
  const explicitDetected = inboundExplicitOutcomeDetected(userMessage);
  const shortAnswerAuthorized = isShortAnswerOutcomeAuthorizedForPersist(userMessage, {
    ...context,
    shortAnswerContext: saca,
  });
  const persisted =
    persistResult.status === "inserted" || persistResult.status === "duplicate";

  return {
    ...buildInboundTruthPersistOutcomeTelemetry(persistResult, {
      stage: "on_no_send",
      persistenceDecision: context?.inboundMeaning?.persistence_decision ?? null,
      noSendReason: context?.noSendReason ?? null,
    }),
    explicit_outcome_detected: explicitDetected,
    short_answer_outcome_authorized: shortAnswerAuthorized,
    prior_question_type: saca?.prior_question_type ?? null,
    outcome_proof_eligible: saca?.outcome_proof_eligible ?? null,
    allowed_persistence: saca?.allowed_persistence ?? null,
    explicit_outcome_persisted_before_no_send: persisted,
    outcome_persist_status_before_no_send: persistResult.status,
    ...(persisted &&
    (persistResult.status === "inserted" || persistResult.status === "duplicate")
      ? { explicit_outcome_persisted_event_type: persistResult.eventType }
      : {}),
    ...(persistResult.status === "skipped"
      ? { outcome_persist_skip_reason_before_no_send: persistResult.skipReason }
      : {}),
  };
}

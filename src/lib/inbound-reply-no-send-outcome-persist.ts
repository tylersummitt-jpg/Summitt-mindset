/**
 * Explicit server-safe outcome persistence when visible inbound reply no-sends.
 */

import { inboundExplicitOutcomeDetected } from "@/lib/inbound-short-answer-clauses";
import type { InboundOutcomePersistResult } from "@/lib/v2-inbound-accountability-outcome-persist";

export function buildExplicitOutcomeBeforeNoSendTelemetry(
  userMessage: string,
  persistResult: InboundOutcomePersistResult
): Record<string, unknown> {
  const persisted =
    persistResult.status === "inserted" || persistResult.status === "duplicate";
  return {
    explicit_outcome_detected: inboundExplicitOutcomeDetected(userMessage),
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

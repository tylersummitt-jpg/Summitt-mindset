/**
 * Sol-specific inbound accountability persist decision.
 * Classifier / regex / live-prompt English gates are not semantic authority here.
 */

import type { V2AccountabilityOutcome, V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import type { InboundOutcomePersistSkipReason } from "@/lib/v2-inbound-accountability-outcome-persist";
import { recentEventsIncludeUserYesOnLocalDay } from "@/lib/north-star-sms-context-packet";
import type { InboundSolBriefExtras } from "@/lib/inbound-sol-coaching-brief";

export type SolInboundPersistAdvice =
  | {
      persist: true;
      resolvedEventType: V2AccountabilityOutcome;
      skipReason?: undefined;
    }
  | {
      persist: false;
      resolvedEventType: null;
      skipReason: InboundOutcomePersistSkipReason;
    };

/**
 * Map Sol inbound extras to a canonical accountability event, or skip.
 * `classifierEventType` is accepted only so tests can prove it cannot create or suppress a Sol outcome.
 */
export function shouldPersistSolInboundAccountabilityOutcome(args: {
  inbound: InboundSolBriefExtras;
  messageSid: string;
  commitmentId: string;
  hasActiveCommitment: boolean;
  exclusiveLaneOwnsTurn: boolean;
  pendingConfirmationConflict: boolean;
  recentEventsNewestFirst?: V2EventRowForAi[];
  timezone?: string | null;
  /** Inbound receive day from packet.message_for.local_date */
  localDayKey?: string | null;
  /** Unused legacy data — must not affect the decision. */
  classifierEventType?: V2InboundEventType | null;
}): SolInboundPersistAdvice {
  void args.classifierEventType;

  if (!args.messageSid.trim()) {
    return { persist: false, resolvedEventType: null, skipReason: "no_message_sid" };
  }
  if (!args.commitmentId.trim() || !args.hasActiveCommitment) {
    return {
      persist: false,
      resolvedEventType: null,
      skipReason: "sol_no_active_commitment",
    };
  }
  if (args.exclusiveLaneOwnsTurn) {
    return {
      persist: false,
      resolvedEventType: null,
      skipReason: "sol_exclusive_lane_owns_turn",
    };
  }
  if (args.pendingConfirmationConflict) {
    return {
      persist: false,
      resolvedEventType: null,
      skipReason: "sol_pending_confirmation_conflict",
    };
  }

  const acc = args.inbound.accountability_interpretation;

  if (acc.confidence === "low") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_low_confidence" };
  }

  if (acc.relevance === "unrelated") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_unrelated" };
  }
  if (acc.relevance === "unclear") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_unclear" };
  }
  if (acc.relevance !== "central" && acc.relevance !== "related") {
    return {
      persist: false,
      resolvedEventType: null,
      skipReason: "sol_relevance_not_related",
    };
  }

  if (acc.outcome === "attempt") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_attempt" };
  }
  if (acc.outcome === "plan") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_plan" };
  }
  if (acc.outcome === "not_applicable") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_not_applicable" };
  }
  if (acc.outcome === "unclear") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_unclear" };
  }

  if (acc.confidence !== "medium" && acc.confidence !== "high") {
    return { persist: false, resolvedEventType: null, skipReason: "sol_low_confidence" };
  }

  let resolvedEventType: V2AccountabilityOutcome | null = null;
  if (acc.outcome === "completed") resolvedEventType = "user_yes";
  else if (acc.outcome === "missed") resolvedEventType = "user_no";
  else if (acc.outcome === "partial") resolvedEventType = "user_partial";

  if (!resolvedEventType) {
    return { persist: false, resolvedEventType: null, skipReason: "sol_not_applicable" };
  }

  if (resolvedEventType === "user_yes") {
    const events = args.recentEventsNewestFirst;
    const timezone = args.timezone?.trim();
    const localDayKey = args.localDayKey?.trim();
    if (events && events.length > 0 && timezone && localDayKey) {
      if (recentEventsIncludeUserYesOnLocalDay(events, timezone, localDayKey)) {
        return {
          persist: false,
          resolvedEventType: null,
          skipReason: "same_day_user_yes_already_recorded",
        };
      }
    }
  }

  return { persist: true, resolvedEventType };
}

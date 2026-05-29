/**
 * Phase 1 — Reliable inbound accountability outcome persistence.
 * Ensures clear yes/no/partial replies to a live check write one spine row before SMS send.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { V2ActiveReplyContext } from "@/lib/v2-active-reply-context";
import type { V2AccountabilityOutcome } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision, V2InboundGatedMode } from "@/lib/v2-ai-inbound";
import type { ProofMomentMeta } from "@/lib/v2-proof-moment";
import { proofMomentPayloadFields } from "@/lib/v2-proof-moment";
import { isClearAccountabilityCompletionReply } from "@/lib/v2-inbound-accountability-completion";
import {
  v2UserReplyIdempotencyKey,
  type V2InboundEventType,
} from "@/lib/v2-sms-accountability";

export { isClearAccountabilityCompletionReply } from "@/lib/v2-inbound-accountability-completion";
import {
  isFutureForwardPlanInbound,
  isGoalIncreaseIntentClarifyInbound,
} from "@/lib/v2-sms-future-stretch-intent";

export type InboundOutcomePersistBranch =
  | "main"
  | "open_question"
  | "central_pivot"
  | "arc_clarify"
  | "conversation_brain_legacy_fallback";

export type InboundOutcomePersistLaneExclusion =
  | "none"
  | "commitment_change_handoff"
  | "identity_edit"
  | "relationship_exit"
  | "soft_opt_out"
  | "repair_reply_only"
  | "future_forward_plan"
  | "goal_increase_clarify"
  | "arc_clarify_only"
  | "blocker_capture_only";

export type InboundOutcomePersistSkipReason =
  | "no_message_sid"
  | "no_commitment_id"
  | "classifier_not_accountability_outcome"
  | "no_live_accountability_prompt"
  | "lane_excluded"
  | "gated_non_outcome_mode"
  | "arc_clarify_only";

export type InboundOutcomePersistResult =
  | {
      status: "inserted";
      eventType: V2AccountabilityOutcome;
      eventId: string;
      idempotencyKey: string;
      overrideGatedNoWrite: boolean;
    }
  | {
      status: "duplicate";
      eventType: V2AccountabilityOutcome;
      idempotencyKey: string;
      overrideGatedNoWrite: boolean;
    }
  | { status: "skipped"; skipReason: InboundOutcomePersistSkipReason; overrideGatedNoWrite?: boolean }
  | { status: "error"; message: string; code?: string; eventType?: V2AccountabilityOutcome };

const GATED_MODES_BLOCKING_PERSIST: ReadonlySet<V2InboundGatedMode> = new Set([
  "commitment_change_handoff",
  "relationship_exit_integrity",
  "identity_edit_integrity",
  "soft_opt_out_reply",
  "repair_reply_only",
]);

const ACCOUNTABILITY_OUTCOMES: ReadonlySet<V2AccountabilityOutcome> = new Set([
  "user_yes",
  "user_no",
  "user_partial",
]);

export function resolveInboundAccountabilityOutcomeEventType(args: {
  classifierEventType: V2InboundEventType;
  gatedDecision: V2InboundGatedDecision;
}): V2AccountabilityOutcome {
  const gated = args.gatedDecision.final_event_type;
  if (
    gated === "user_yes" ||
    gated === "user_no" ||
    gated === "user_partial"
  ) {
    return gated;
  }
  return args.classifierEventType;
}

export function laneExclusionFromGatedMode(
  mode: V2InboundGatedMode
): InboundOutcomePersistLaneExclusion | "none" {
  if (mode === "commitment_change_handoff") return "commitment_change_handoff";
  if (mode === "identity_edit_integrity") return "identity_edit";
  if (mode === "relationship_exit_integrity") return "relationship_exit";
  if (mode === "soft_opt_out_reply") return "soft_opt_out";
  if (mode === "repair_reply_only") return "repair_reply_only";
  return "none";
}

export type ShouldPersistInboundAccountabilityOutcomeArgs = {
  messageSid: string;
  commitmentId: string;
  rawBody: string;
  classifierEventType: V2InboundEventType;
  gatedDecision: V2InboundGatedDecision;
  laneExclusion: InboundOutcomePersistLaneExclusion;
  activeReplyContext: Pick<
    V2ActiveReplyContext,
    "has_live_accountability_prompt" | "self_contained_accountability_answer"
  > | null;
};

export type ShouldPersistInboundAccountabilityOutcomeResult =
  | {
      persist: true;
      resolvedEventType: V2AccountabilityOutcome;
      liveAccountabilityPromptDetected: boolean;
      overrideGatedNoWrite: boolean;
    }
  | { persist: false; skipReason: InboundOutcomePersistSkipReason };

export function shouldPersistInboundAccountabilityOutcome(
  args: ShouldPersistInboundAccountabilityOutcomeArgs
): ShouldPersistInboundAccountabilityOutcomeResult {
  const messageSid = args.messageSid.trim();
  if (!messageSid) {
    return { persist: false, skipReason: "no_message_sid" };
  }

  const commitmentId = args.commitmentId.trim();
  if (!commitmentId) {
    return { persist: false, skipReason: "no_commitment_id" };
  }

  if (!ACCOUNTABILITY_OUTCOMES.has(args.classifierEventType)) {
    return { persist: false, skipReason: "classifier_not_accountability_outcome" };
  }

  const raw = args.rawBody.trim();
  if (isFutureForwardPlanInbound(raw)) {
    return { persist: false, skipReason: "lane_excluded" };
  }
  if (isGoalIncreaseIntentClarifyInbound(raw)) {
    return { persist: false, skipReason: "lane_excluded" };
  }

  if (args.laneExclusion !== "none") {
    if (args.laneExclusion === "future_forward_plan") {
      return { persist: false, skipReason: "lane_excluded" };
    }
    if (args.laneExclusion === "goal_increase_clarify") {
      return { persist: false, skipReason: "lane_excluded" };
    }
    if (args.laneExclusion === "arc_clarify_only") {
      return { persist: false, skipReason: "arc_clarify_only" };
    }
    return { persist: false, skipReason: "lane_excluded" };
  }

  if (GATED_MODES_BLOCKING_PERSIST.has(args.gatedDecision.mode)) {
    return { persist: false, skipReason: "gated_non_outcome_mode" };
  }

  const livePrompt = args.activeReplyContext?.has_live_accountability_prompt === true;
  const selfContained = args.activeReplyContext?.self_contained_accountability_answer === true;
  const clearCompletion = isClearAccountabilityCompletionReply(raw);
  const promptOk = livePrompt || selfContained || clearCompletion;

  if (!promptOk) {
    return { persist: false, skipReason: "no_live_accountability_prompt" };
  }

  const overrideGatedNoWrite = args.gatedDecision.should_write_outcome_event === false;

  if (
    !args.gatedDecision.should_write_outcome_event &&
    args.gatedDecision.mode === "clarify" &&
    !clearCompletion &&
    !selfContained
  ) {
    return { persist: false, skipReason: "gated_non_outcome_mode" };
  }

  return {
    persist: true,
    resolvedEventType: resolveInboundAccountabilityOutcomeEventType({
      classifierEventType: args.classifierEventType,
      gatedDecision: args.gatedDecision,
    }),
    liveAccountabilityPromptDetected: livePrompt,
    overrideGatedNoWrite,
  };
}

export function logInboundOutcomePersistAttempt(args: {
  messageSid: string;
  commitmentId: string;
  branch: InboundOutcomePersistBranch;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  gatedDecision: V2InboundGatedDecision;
  resolvedEventType?: V2AccountabilityOutcome;
  liveAccountabilityPromptDetected: boolean;
  result: InboundOutcomePersistResult | ShouldPersistInboundAccountabilityOutcomeResult;
  idempotencyKey?: string;
}): void {
  const gated = args.gatedDecision;
  const base = {
    message_sid: args.messageSid,
    commitment_id: args.commitmentId,
    branch: args.branch,
    classifier_event_type: args.classifierEventType,
    classifier_normalized_hint: args.classifierNormalizedHint,
    gated_should_write: gated.should_write_outcome_event,
    gated_mode: gated.mode,
    gated_final_event_type: gated.final_event_type,
    resolved_event_type: args.resolvedEventType ?? null,
    live_accountability_prompt_detected: args.liveAccountabilityPromptDetected,
    idempotency_key: args.idempotencyKey ?? null,
  };

  if ("persist" in args.result && args.result.persist === false) {
    console.info("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "skipped",
      outcome_persist_skip_reason: args.result.skipReason,
    });
    return;
  }

  if (args.result.status === "skipped") {
    console.info("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "skipped",
      outcome_persist_skip_reason: args.result.skipReason,
    });
    return;
  }

  if (args.result.status === "error") {
    console.warn("[inbound-outcome-persist]", {
      ...base,
      outcome_persist_status: "error",
      outcome_persist_error: args.result.message,
      outcome_persist_error_code: args.result.code ?? null,
    });
    return;
  }

  console.info("[inbound-outcome-persist]", {
    ...base,
    outcome_persist_status: args.result.status,
    override_gated_no_write:
      args.result.status === "inserted" || args.result.status === "duplicate"
        ? args.result.overrideGatedNoWrite
        : false,
  });
}

export type PersistInboundAccountabilityOutcomeEventArgs = {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  rawBody: string;
  eventType: V2AccountabilityOutcome;
  branch: InboundOutcomePersistBranch;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  gatedDecision: V2InboundGatedDecision;
  liveAccountabilityPromptDetected: boolean;
  overrideGatedNoWrite: boolean;
  proofMeta: ProofMomentMeta | null;
  payloadJson: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function persistInboundAccountabilityOutcomeEvent(
  args: PersistInboundAccountabilityOutcomeEventArgs
): Promise<InboundOutcomePersistResult> {
  const idempotencyKey =
    args.idempotencyKey ?? v2UserReplyIdempotencyKey(args.eventType, args.messageSid);

  const payload: Record<string, unknown> = {
    message_sid: args.messageSid,
    source_path: "sms_inbound_accountability",
    outcome_persist_branch: args.branch,
    message: args.rawBody,
    ...(args.classifierNormalizedHint != null
      ? { normalized_hint: args.classifierNormalizedHint }
      : {}),
    ...(args.overrideGatedNoWrite
      ? { outcome_persist_override_gated_no_write: true }
      : {}),
    ...proofMomentPayloadFields(args.proofMeta),
    ...args.payloadJson,
  };

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: args.eventType,
      source: "sms_v2_accountability",
      payload_json: payload,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return {
        status: "duplicate",
        eventType: args.eventType,
        idempotencyKey,
        overrideGatedNoWrite: args.overrideGatedNoWrite,
      };
    }
    return {
      status: "error",
      message: error.message,
      code,
      eventType: args.eventType,
    };
  }

  if (!data?.id || typeof data.id !== "string") {
    return {
      status: "error",
      message: "insert_succeeded_without_row_id",
      eventType: args.eventType,
    };
  }

  return {
    status: "inserted",
    eventType: args.eventType,
    eventId: data.id,
    idempotencyKey,
    overrideGatedNoWrite: args.overrideGatedNoWrite,
  };
}

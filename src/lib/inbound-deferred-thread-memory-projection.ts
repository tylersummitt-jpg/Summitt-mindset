/**
 * Slice 2A+2B+2C — pure policy for binding-adjacent inbound outbound thread-memory projection.
 * No I/O; callers pass final post-NS/FVG bodies only.
 */

import {
  extractCoachQuestionFromOutboundBody,
  isBindingYesNoQuestion,
} from "@/lib/v2-commitment-sms-thread-memory";

const BINDING_EXPECTED_ANSWER_TYPES = new Set(["proposal_yes_no", "contract_yes_no"]);

export type InboundCoachReplyThreadMemoryContext = {
  commitmentId: string;
  expectedAnswerType?: string | null;
  clearBindingOpenQuestion?: boolean;
};

const RESOLVED_OVERLAY_ACTIONS = new Set([
  "activated",
  "declined",
  "accepted",
  "rejected",
  "activation_applied",
  "decline_applied",
]);

const NOOP_OVERLAY_ACTIONS = new Set([
  "noop_already_applied",
  "noop_not_found",
  "noop_state_conflict",
]);

export function resolveContractConsentAckExpectedAnswerType(_args: {
  overlayAction?: string | null;
  rpcResult?: string | null;
  proposalStillValid?: boolean;
}): null {
  return null;
}

export function shouldClearBindingOpenQuestionOnContractAck(args: {
  overlayAction?: string | null;
  rpcResult?: string | null;
  proposalStillValid?: boolean;
}): boolean {
  const action = args.overlayAction?.trim().toLowerCase() ?? "";
  if (!action) return false;

  if (RESOLVED_OVERLAY_ACTIONS.has(action)) return true;

  if (NOOP_OVERLAY_ACTIONS.has(action)) {
    return args.proposalStillValid !== true;
  }

  return false;
}

export function resolveAdaptiveClarificationExpectedAnswerType(args: {
  stateRemainsPending: boolean;
  gatedBody: string;
}): "proposal_yes_no" | null {
  if (args.stateRemainsPending !== true) return null;

  const body = args.gatedBody.trim();
  if (!body) return null;

  const extracted = extractCoachQuestionFromOutboundBody({
    sentBody: body,
    expectedAnswerType: "proposal_yes_no",
  });
  if (!extracted || !isBindingYesNoQuestion(extracted)) return null;

  return "proposal_yes_no";
}

/** Slice 2C — derive SMS pending state from Wave4 facts (no DB). */
export function deriveCommitmentChangeHandoffSmsStateFromFacts(args: {
  pendingResolutionCreated: boolean;
  serverStateTransitionSummary: string | null | undefined;
}): string | null {
  if (!args.pendingResolutionCreated) return null;
  const summary = (args.serverStateTransitionSummary ?? "").trim();
  if (summary.includes("bootstrap:awaiting_confirmation")) return "awaiting_confirmation";
  return "awaiting_candidate";
}

export function resolveCommitmentChangeHandoffExpectedAnswerType(_args: {
  smsState: string | null | undefined;
  pendingKind: string | null | undefined;
  gatedBody: string;
}): null {
  return null;
}

export function shouldClearBindingOpenQuestionOnCommitmentHandoff(args: {
  smsState: string | null | undefined;
  priorExpectedType?: string | null;
}): boolean {
  if ((args.smsState ?? "").trim() !== "awaiting_confirmation") return false;
  const prior = args.priorExpectedType?.trim().toLowerCase() ?? "";
  return BINDING_EXPECTED_ANSWER_TYPES.has(prior);
}

export function buildCommitmentChangeHandoffThreadMemoryContext(args: {
  commitmentId: string;
  smsState: string | null | undefined;
  pendingKind: string | null | undefined;
  gatedBody: string;
  priorExpectedType?: string | null;
}): InboundCoachReplyThreadMemoryContext {
  return {
    commitmentId: args.commitmentId.trim(),
    expectedAnswerType: resolveCommitmentChangeHandoffExpectedAnswerType({
      smsState: args.smsState,
      pendingKind: args.pendingKind,
      gatedBody: args.gatedBody,
    }),
    clearBindingOpenQuestion: shouldClearBindingOpenQuestionOnCommitmentHandoff({
      smsState: args.smsState,
      priorExpectedType: args.priorExpectedType,
    }),
  };
}

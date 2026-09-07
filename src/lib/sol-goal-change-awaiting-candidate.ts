/**
 * Slice 5 Turn-2 correction — Sol owns commitment_replace / awaiting_candidate.
 *
 * Production route:
 *   authoritative pending reload
 *   → exact whole-message clock structural fast path OR Slice 1 Sol interpreter
 *   → deterministic server consequence
 *   → reload
 *   → Sol relationship writer
 *
 * Code may fill a known clock slot. Code must not interpret natural-language Turn 2.
 * Leftover regex / leftover candidate AI / V3 must not be the semantic owner of this hallway.
 *
 * Predeploy compatibility: any parseable sms_inbound + commitment_replace
 * pending whose sms_state is awaiting_candidate (or omitted, which defaults)
 * is eligible. Does not require Slice-5-only metadata
 * (openedAsAwaitingCandidateShell, TU ids, awaiting_candidate_reason).
 * Existing parsePayload still requires Wave4 fields: detected_intent,
 * raw_user_text, inbound_message_sid. Tighten / refresh / guided / adaptive
 * remain on leftover.
 *
 * Residual model-fabrication risk: Sol may invent a complete-looking replacement
 * sentence. There is no second English parser or inbound-token grounder.
 * Envelope: Turn 2 never applies; Slice 3 still requires confirm + RPC + reload.
 */

import type OpenAI from "openai";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  mergeSmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import {
  buildSolGoalChangeSemanticInput,
  type SolGoalChangeAuthoritativePending,
  type SolGoalChangeSemanticResult,
  type SolGoalChangeSemanticThreadMessage,
} from "@/lib/sol-goal-change-semantic";
import { runSolGoalChangeSemanticInterpreter } from "@/lib/sol-goal-change-semantic-interpreter";
import {
  confirmationAuthorizationFromReloadedCommitment,
  isStructuralIncompleteReplacementCandidate,
  normalizeSemanticSavedReplaceCandidate,
} from "@/lib/sol-goal-change-pending-open";
import {
  SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  isSolGoalChangeClockOnlyFragment,
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-clock-substitute";

const RAW_LOG_MAX = 280;

export { isStructuralIncompleteReplacementCandidate };

export type SolGoalChangeAwaitingCandidateConsequence =
  | "staged"
  | "rejected"
  | "stay_hallway"
  | "not_applicable";

export type SolGoalChangeAwaitingCandidateForensics = {
  interpreter_invoked: boolean;
  interpreter_ok: boolean | null;
  interpreter_error: string | null;
  clock_structural_used: boolean;
  leftover_candidate_ai_invoked: false;
  parse_sms_confirmation_used: false;
  semantic_intent: string | null;
  semantic_rejects: boolean | null;
  candidate_complete: boolean | null;
  skip_reason: string | null;
};

export type SolGoalChangeAwaitingCandidateResult = {
  handled: boolean;
  commitment: ActiveV2CommitmentRow;
  authorization: SolGoalChangeConfirmationAuthorization;
  consequence: SolGoalChangeAwaitingCandidateConsequence;
  forensics: SolGoalChangeAwaitingCandidateForensics;
};

function emptyForensics(
  extras: Partial<SolGoalChangeAwaitingCandidateForensics> = {}
): SolGoalChangeAwaitingCandidateForensics {
  return {
    interpreter_invoked: false,
    interpreter_ok: null,
    interpreter_error: null,
    clock_structural_used: false,
    leftover_candidate_ai_invoked: false,
    parse_sms_confirmation_used: false,
    semantic_intent: null,
    semantic_rejects: null,
    candidate_complete: null,
    skip_reason: null,
    ...extras,
  };
}

/**
 * True when leftover must not own this turn.
 * Compatible with predeploy replace awaiting_candidate rows that have
 * source=sms_inbound and kind=commitment_replace. sms_state may be omitted
 * (defaults to awaiting_candidate). Candidate may be null.
 */
export function isSolOwnedReplaceAwaitingCandidatePending(
  commitment: ActiveV2CommitmentRow
): boolean {
  if (!isSmsInboundPendingResolutionActionable(commitment)) return false;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending?.payload) return false;
  if (pending.payload.source !== "sms_inbound") return false;
  if (pending.kind !== "commitment_replace") return false;
  const st = pending.payload.sms_state ?? "awaiting_candidate";
  return st === "awaiting_candidate";
}

export function awaitingCandidateAuthorizationFromReloadedCommitment(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeConfirmationAuthorization {
  const canonical = (commitment.behavior_statement ?? "").trim();
  if (!isSolOwnedReplaceAwaitingCandidatePending(commitment)) {
    return {
      ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
      canonical_behavior_statement: canonical,
      active_commitment_id: commitment.id,
      pending_cleared: !isSmsInboundPendingResolutionActionable(commitment),
    };
  }
  return {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
    canonical_behavior_statement: canonical,
    pending_state: "awaiting_candidate",
    candidate_behavior_statement: null,
    active_commitment_id: commitment.id,
    pending_cleared: false,
  };
}

function pendingSnapshotFromCommitment(
  commitment: ActiveV2CommitmentRow
): SolGoalChangeAuthoritativePending | null {
  if (!isSmsInboundPendingResolutionActionable(commitment)) return null;
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending) return null;
  const payload = pending.payload;
  if (!payload || payload.source !== "sms_inbound") return null;
  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return null;
  }
  const smsState = payload.sms_state ?? "awaiting_candidate";
  return {
    actionable: true,
    kind: pending.kind,
    sms_state:
      smsState === "awaiting_confirmation" || smsState === "awaiting_candidate"
        ? smsState
        : null,
    candidate_behavior_statement:
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_new_bar?.trim() ||
      payload.candidate_tightened_bar?.trim() ||
      null,
    source: payload.source === "sms_inbound" ? "sms_inbound" : null,
  };
}

function tryCompleteTurn2Candidate(args: {
  semanticCandidate: string;
  canonicalBehaviorStatement: string;
  inboundRaw: string;
}): { ok: true; candidate: string } | { ok: false; reason: string } {
  const normalized = normalizeSemanticSavedReplaceCandidate(args);
  if (!normalized.ok) return normalized;
  if (isStructuralIncompleteReplacementCandidate(normalized.candidate)) {
    return { ok: false, reason: "incomplete_replacement_fragment" };
  }
  return normalized;
}

async function stageAwaitingConfirmationCandidate(args: {
  commitment: ActiveV2CommitmentRow;
  nextCandidate: string;
  inboundRaw: string;
  messageSid: string;
}): Promise<ActiveV2CommitmentRow> {
  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: args.commitment.id,
    merge: (prev) => ({
      ...prev,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: args.nextCandidate,
      candidate_new_bar: args.nextCandidate,
      raw_user_text: args.inboundRaw.slice(0, RAW_LOG_MAX),
      inbound_message_sid: args.messageSid,
      confirmation_prompt_sent_at: new Date().toISOString(),
    }),
  });
  if (merged.ok) {
    await recomputeV2CoachingMemory(args.commitment.id, {
      reasonCode: "sms_pending_resolution_candidate_refined",
    });
  }
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

async function clearPendingKeepCurrent(args: {
  commitment: ActiveV2CommitmentRow;
}): Promise<ActiveV2CommitmentRow> {
  await clearPendingResolution(args.commitment.id, {
    expectedUpdatedAt: args.commitment.updated_at,
  });
  await recomputeV2CoachingMemory(args.commitment.id, {
    reasonCode: "sms_pending_resolution_keep_current_cleared",
  });
  return (await getActiveCommitment(args.commitment.clerk_user_id)) ?? args.commitment;
}

function stayHallway(
  commitment: ActiveV2CommitmentRow,
  forensics: Partial<SolGoalChangeAwaitingCandidateForensics>
): SolGoalChangeAwaitingCandidateResult {
  return {
    handled: true,
    commitment,
    authorization: awaitingCandidateAuthorizationFromReloadedCommitment(commitment),
    consequence: "stay_hallway",
    forensics: emptyForensics(forensics),
  };
}

function semanticSuppliesCandidate(semantic: SolGoalChangeSemanticResult): string | null {
  const g = semantic.goal_change;
  if (g.rejects_existing_pending) return null;
  if (g.needs_clarification) return null;
  const candidate = g.candidate_behavior_statement?.trim() ?? "";
  if (!candidate) return null;
  if (
    g.intent !== "saved_replace" &&
    g.intent !== "possible_saved_replace" &&
    !g.modifies_existing_pending_candidate
  ) {
    return null;
  }
  return candidate;
}

export async function runSolGoalChangeAwaitingCandidateForInbound(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  inboundRaw: string;
  messageSid: string;
  timezone?: string | null;
  recentExactThread?: SolGoalChangeSemanticThreadMessage[] | null;
  client?: OpenAI | null;
}): Promise<SolGoalChangeAwaitingCandidateResult> {
  const inbound = args.inboundRaw.trim();
  const liveStart = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;

  if (!isSolOwnedReplaceAwaitingCandidatePending(liveStart)) {
    return {
      handled: false,
      commitment: liveStart,
      authorization: confirmationAuthorizationFromReloadedCommitment(liveStart),
      consequence: "not_applicable",
      forensics: emptyForensics({ skip_reason: "not_replace_awaiting_candidate" }),
    };
  }

  const canonical = (liveStart.behavior_statement ?? "").trim();

  if (isSolGoalChangeClockOnlyFragment(inbound)) {
    const substituted = trySubstituteClockFragmentIntoCanonical(canonical, inbound);
    if (substituted?.trim() && !isSolGoalChangeClockOnlyFragment(substituted)) {
      const complete = tryCompleteTurn2Candidate({
        semanticCandidate: substituted.trim(),
        canonicalBehaviorStatement: canonical,
        inboundRaw: inbound,
      });
      if (complete.ok) {
        const staged = await stageAwaitingConfirmationCandidate({
          commitment: liveStart,
          nextCandidate: complete.candidate,
          inboundRaw: inbound,
          messageSid: args.messageSid,
        });
        return {
          handled: true,
          commitment: staged,
          authorization: confirmationAuthorizationFromReloadedCommitment(
            staged,
            complete.candidate
          ),
          consequence: "staged",
          forensics: emptyForensics({
            clock_structural_used: true,
            interpreter_invoked: false,
            candidate_complete: true,
          }),
        };
      }
      return stayHallway(liveStart, {
        clock_structural_used: true,
        interpreter_invoked: false,
        candidate_complete: false,
        skip_reason: complete.reason,
      });
    }
  }

  const semanticInput = buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: canonical,
    effectiveCoachingAsk: getEffectiveCoachingAsk(liveStart),
    authoritativePending: pendingSnapshotFromCommitment(liveStart),
    latestInboundText: inbound,
    recentExactThread: args.recentExactThread,
    plannedInterruptionKnown: false,
    timezone: args.timezone,
    localDaypart: "inbound",
  });

  let semantic: SolGoalChangeSemanticResult | null = null;
  let interpreterOk = false;
  let interpreterError: string | null = null;
  try {
    const interpreted = await runSolGoalChangeSemanticInterpreter({
      input: semanticInput,
      client: args.client,
    });
    interpreterOk = interpreted.ok;
    if (interpreted.ok) {
      semantic = interpreted.result;
    } else {
      interpreterError = interpreted.error;
    }
  } catch (e) {
    interpreterOk = false;
    interpreterError = e instanceof Error ? e.message : "interpreter_threw";
  }

  const baseForensics: Partial<SolGoalChangeAwaitingCandidateForensics> = {
    interpreter_invoked: true,
    interpreter_ok: interpreterOk,
    interpreter_error: interpreterError,
    clock_structural_used: false,
    semantic_intent: semantic?.goal_change.intent ?? null,
    semantic_rejects: semantic?.goal_change.rejects_existing_pending ?? null,
  };

  if (!interpreterOk || !semantic) {
    return stayHallway(liveStart, {
      ...baseForensics,
      skip_reason: interpreterError ?? "interpreter_unavailable",
    });
  }

  if (semantic.goal_change.rejects_existing_pending) {
    const cleared = await clearPendingKeepCurrent({ commitment: liveStart });
    return {
      handled: true,
      commitment: cleared,
      authorization: {
        ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
        canonical_behavior_statement: (cleared.behavior_statement ?? "").trim(),
        active_commitment_id: cleared.id,
        pending_cleared: true,
      },
      consequence: "rejected",
      forensics: emptyForensics({
        ...baseForensics,
        candidate_complete: false,
      }),
    };
  }

  const supplied = semanticSuppliesCandidate(semantic);
  if (!supplied) {
    return stayHallway(liveStart, {
      ...baseForensics,
      candidate_complete: false,
      skip_reason: semantic.goal_change.needs_clarification
        ? "needs_clarification"
        : "no_usable_candidate",
    });
  }

  const complete = tryCompleteTurn2Candidate({
    semanticCandidate: supplied,
    canonicalBehaviorStatement: canonical,
    inboundRaw: inbound,
  });
  if (!complete.ok) {
    return stayHallway(liveStart, {
      ...baseForensics,
      candidate_complete: false,
      skip_reason: complete.reason,
    });
  }

  const staged = await stageAwaitingConfirmationCandidate({
    commitment: liveStart,
    nextCandidate: complete.candidate,
    inboundRaw: inbound,
    messageSid: args.messageSid,
  });
  return {
    handled: true,
    commitment: staged,
    authorization: confirmationAuthorizationFromReloadedCommitment(staged, complete.candidate),
    consequence: "staged",
    forensics: emptyForensics({
      ...baseForensics,
      candidate_complete: true,
    }),
  };
}

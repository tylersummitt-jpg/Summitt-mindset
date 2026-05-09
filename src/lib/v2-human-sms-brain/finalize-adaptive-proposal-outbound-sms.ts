/**
 * Phase 3A — Humanize adaptive contract proposal SMS bodies (shrink / recommit) only.
 * No Supabase. Does not change adaptive_proposal_text or event proposal_text.
 */

import {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION,
  rewriteMachineDraftToHumanSms,
} from "@/lib/v2-human-sms-brain/human-sms-brain";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import type { HumanSmsBrainInput } from "@/lib/v2-human-sms-brain/types";
import {
  isV2HumanSmsBrainEnabled,
  isV2HumanSmsPhase3AdaptiveProposalEnabled,
  isV2HumanVisibleSmsValidatorEnforce,
  isV2HumanVisibleSmsValidatorShadow,
  shouldRunPhase3AdaptiveProposalBrain,
  warnIfPhase3BrainWithoutValidatorEnforce,
} from "@/lib/v2-human-sms-brain/flags";
import { hashSmsSnippet, validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { HUMAN_VISIBLE_SMS_VALIDATOR_VERSION } from "@/lib/v2-human-visible-sms/types";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";

const DEFAULT_MAX = 320;

export type AdaptiveProposalKind = "shrink" | "recommit_same";

export function brainCaseForAdaptiveProposalKind(kind: AdaptiveProposalKind): HumanSmsBrainCase {
  return kind === "shrink" ? "adaptive_proposal_shrink" : "adaptive_proposal_recommit_same";
}

export function adaptiveProposalCuratedFallbackForKind(kind: AdaptiveProposalKind): string {
  switch (kind) {
    case "shrink":
      return "Want to keep the next week simpler—one honest rep a day? A clear yes or no is enough.";
    case "recommit_same":
      return "Want me holding the same line steady for the week? A clear yes or no is enough.";
    default:
      return "Are you in for that? A clear yes or no is enough.";
  }
}

export type FinalizeAdaptiveProposalOutboundSmsResult = {
  message: string;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  validationFailed: boolean;
  validatorMode: "enforce" | "shadow_only";
  brainRewriteMs: number | null;
  brainFixMs: number | null;
  /** When V3 refine lane applied; pass to a second North Star pass to skip duplicate OpenAI finalizer. */
  northStarReplySource?: string | null;
};

function logPipeline(args: {
  brainCase: HumanSmsBrainCase;
  proposalKind: AdaptiveProposalKind;
  bindingHash: string | null;
  brainMasterOn: boolean;
  validatorMode: "enforce" | "shadow_only";
  validationOk: boolean;
  validationFailureReason: string | null;
  bannedHit: string | null;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  repairOpenAiAttempted: boolean;
  brainRewriteMs: number | null;
  brainFixMs: number | null;
  finalText: string;
}) {
  console.info("[human_visible_sms_pipeline]", {
    event: "human_visible_sms_pipeline",
    path: "adaptive_proposal_outbound",
    proposal_kind: args.proposalKind,
    brain_case: args.brainCase,
    binding_hash: args.bindingHash,
    brain_enabled: args.brainMasterOn,
    validator_mode: args.validatorMode,
    validation_ok: args.validationOk,
    validation_failure_reason: args.validationFailureReason,
    banned_hit: args.bannedHit,
    brain_used: args.brainUsed,
    brain_failure_reason: args.brainFailureReason,
    fallback_used: args.fallbackUsed,
    repair_openai_attempted: args.repairOpenAiAttempted,
    brain_rewrite_ms: args.brainRewriteMs,
    brain_fix_ms: args.brainFixMs,
    validator_version: HUMAN_VISIBLE_SMS_VALIDATOR_VERSION,
    brain_prompt_version: PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION,
    final_len: args.finalText.length,
    final_hash: hashSmsSnippet(args.finalText),
  });
}

export async function finalizeAdaptiveProposalOutboundSms(args: {
  machineDraft: string;
  proposalKind: AdaptiveProposalKind;
  bindingText: string;
  behaviorStatementPreview: string;
  templateId?: number | null;
  maxChars?: number;
  /** When set, V3 refine lane owns visible voice (Phase 3A rewrite skipped when refine applies). */
  v3Refine?: {
    clerkUserId: string;
    messageSid: string;
    commitment: ActiveV2CommitmentRow;
    timezone: string;
  };
}): Promise<FinalizeAdaptiveProposalOutboundSmsResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const bindingHash = args.bindingText.trim() ? hashSmsSnippet(args.bindingText.trim()) : null;
  const brainCase = brainCaseForAdaptiveProposalKind(args.proposalKind);

  if (isV2HumanSmsPhase3AdaptiveProposalEnabled() && isV2HumanSmsBrainEnabled()) {
    warnIfPhase3BrainWithoutValidatorEnforce();
  }

  let text = args.machineDraft.trim();
  let v3ReplySource: string | undefined;
  let v3ContextPacket: NorthStarSmsContextPacket | undefined;
  let v3LaneApplied = false;

  if (args.v3Refine) {
    try {
      const { refineMachineSmsBodyWithV3RefineLane } = await import("@/lib/v3-sms-machine-refine");
      const r = await refineMachineSmsBodyWithV3RefineLane({
        clerkUserId: args.v3Refine.clerkUserId,
        messageSid: args.v3Refine.messageSid,
        commitment: args.v3Refine.commitment,
        timezone: args.v3Refine.timezone,
        inboundRaw: "[adaptive_proposal_outbound]",
        machineBody: args.machineDraft.trim(),
        hintSource: "adaptive_proposal_outbound",
        ownedReplySource: "v3_adaptive_proposal_refined",
      });
      text = r.body;
      v3ReplySource = r.replySource;
      v3ContextPacket = r.contextPacket;
      v3LaneApplied = Boolean(r.replySource);
    } catch (e) {
      console.warn("[v3-sms-brain] adaptive_proposal_v3_refine_failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let brainUsed = v3LaneApplied;
  let brainFailureReason: string | null = null;
  let fallbackUsed: string | null = null;
  let repairOpenAiAttempted = false;
  let brainRewriteMs: number | null = null;
  let brainFixMs: number | null = null;

  const enforce = isV2HumanVisibleSmsValidatorEnforce();
  const validatorMode: "enforce" | "shadow_only" = enforce ? "enforce" : "shadow_only";
  const brainMasterOn = isV2HumanSmsBrainEnabled();
  /** Daily adaptive proposals pass v3Refine — Phase 3A must not own visible voice (V3 refine + NS only). */
  const brainAllowed =
    shouldRunPhase3AdaptiveProposalBrain() && !v3LaneApplied && args.v3Refine == null;

  const brainContext: HumanSmsBrainInput["context"] = {
    adaptiveProposal: {
      proposalKind: args.proposalKind,
      bindingPreview: args.bindingText.trim().slice(0, 240),
      behaviorPreview: args.behaviorStatementPreview.trim().slice(0, 120),
      templateId: args.templateId ?? null,
    },
  };

  const runValidate = (s: string) =>
    validateHumanVisibleSms(s, {
      channel: "adaptive_proposal_outbound",
      maxChars,
      allowVictoryRoomPhrase: false,
    });

  const northStarContextBase = (): NorthStarSmsContextPacket =>
    v3ContextPacket ?? {
      behaviorStatement: args.behaviorStatementPreview,
      effectiveAskText: args.bindingText,
      source: "adaptive_proposal_outbound",
    };

  if (brainAllowed) {
    const t0 = performance.now();
    const brain = await rewriteMachineDraftToHumanSms({
      brainCase,
      machineDraft: text,
      promptVersion: PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION,
      context: brainContext,
    });
    brainRewriteMs = Math.round(performance.now() - t0);
    if (brain.ok) {
      text = brain.message;
      brainUsed = true;
    } else {
      brainFailureReason = brain.reason;
    }
  }

  let validationFailed = false;
  let v = runValidate(text);

  if (!v.ok) {
    validationFailed = true;
    if (isV2HumanVisibleSmsValidatorShadow()) {
      console.info("[human_visible_sms_pipeline]", {
        event: "human_visible_sms_pipeline",
        path: "adaptive_proposal_outbound",
        validator_shadow: true,
        proposal_kind: args.proposalKind,
        validation_ok: false,
        validation_failure_reason: v.reason,
        draft_len: text.length,
        draft_hash: hashSmsSnippet(text),
        brain_case: brainCase,
      });
    }

    if (!enforce) {
      const gatedEarly = (
        await finalizeNorthStarCoachSmsAsync({
          proposedBody: text,
          channel: "contract_prompt",
          behaviorStatement: args.behaviorStatementPreview,
          effectiveAskText: args.bindingText,
          replySource: v3ReplySource,
          contextPacket: northStarContextBase(),
        })
      ).visibleBody.slice(0, maxChars);
      logPipeline({
        brainCase,
        proposalKind: args.proposalKind,
        bindingHash,
        brainMasterOn,
        validatorMode,
        validationOk: false,
        validationFailureReason: v.reason,
        bannedHit: "bannedTerm" in v ? v.bannedTerm ?? null : null,
        brainUsed,
        brainFailureReason,
        fallbackUsed: null,
        repairOpenAiAttempted: false,
        brainRewriteMs,
        brainFixMs,
        finalText: gatedEarly,
      });
      return {
        message: gatedEarly,
        brainUsed,
        brainFailureReason,
        fallbackUsed: null,
        validationFailed: true,
        validatorMode,
        brainRewriteMs,
        brainFixMs,
        northStarReplySource: v3ReplySource ?? null,
      };
    }

    if (brainMasterOn && enforce) {
      repairOpenAiAttempted = true;
      const tFix = performance.now();
      const retry = await rewriteMachineDraftToHumanSms({
        brainCase,
        machineDraft: `FIX this SMS to remove banned jargon and system words while keeping yes/no consent meaning: ${text}`,
        promptVersion: HUMAN_SMS_BRAIN_PROMPT_VERSION,
        context: brainContext,
      });
      brainFixMs = Math.round(performance.now() - tFix);
      if (retry.ok) {
        text = retry.message;
        brainUsed = true;
        v = runValidate(text);
      }
    }

    if (!v.ok) {
      const fb = adaptiveProposalCuratedFallbackForKind(args.proposalKind);
      const v2 = runValidate(fb);
      if (v2.ok) {
        text = fb;
        fallbackUsed = "curated_fallback_for_kind";
      } else {
        const minimal = "Are you in? A clear yes or no is enough.";
        text = runValidate(minimal).ok ? minimal : fb.slice(0, maxChars);
        fallbackUsed = "minimal_or_curated_slice";
      }
    }
  }

  text = (
    await finalizeNorthStarCoachSmsAsync({
      proposedBody: text,
      channel: "contract_prompt",
      behaviorStatement: args.behaviorStatementPreview,
      effectiveAskText: args.bindingText,
      replySource: v3ReplySource,
      contextPacket: northStarContextBase(),
    })
  ).visibleBody.slice(0, maxChars);

  const finalCheck = runValidate(text);
  logPipeline({
    brainCase,
    proposalKind: args.proposalKind,
    bindingHash,
    brainMasterOn,
    validatorMode,
    validationOk: finalCheck.ok,
    validationFailureReason: finalCheck.ok ? null : finalCheck.reason,
    bannedHit: finalCheck.ok ? null : ("bannedTerm" in finalCheck ? finalCheck.bannedTerm ?? null : null),
    brainUsed,
    brainFailureReason,
    fallbackUsed,
    repairOpenAiAttempted,
    brainRewriteMs,
    brainFixMs,
    finalText: text,
  });

  return {
    message: text,
    brainUsed,
    brainFailureReason,
    fallbackUsed,
    validationFailed,
    validatorMode,
    brainRewriteMs,
    brainFixMs,
    northStarReplySource: v3ReplySource ?? null,
  };
}

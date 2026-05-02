/**
 * Phase 5A — Reactivation outbound, central tether, ARC clarification, stitched inbound polish.
 * No DB. Does not change scoring, pivot eligibility, or events — wording only.
 */

import {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  rewriteMachineDraftToHumanSms,
} from "@/lib/v2-human-sms-brain/human-sms-brain";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import type { HumanSmsBrainInput, Phase5aBrainContext } from "@/lib/v2-human-sms-brain/types";
import { PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION } from "@/lib/v2-human-sms-brain/types";
import {
  isV2HumanSmsBrainEnabled,
  isV2HumanVisibleSmsValidatorEnforce,
  isV2HumanVisibleSmsValidatorShadow,
  shouldRunPhase5aArcClarifyBrain,
  shouldRunPhase5aCentralTetherBrain,
  shouldRunPhase5aInboundStitchedFinalBrain,
  shouldRunPhase5aReactivationOutboundBrain,
  warnIfPhase5aBrainWithoutValidatorEnforce,
} from "@/lib/v2-human-sms-brain/flags";
import { hashSmsSnippet, validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import type { HumanVisibleSmsChannel } from "@/lib/v2-human-visible-sms/types";
import { HUMAN_VISIBLE_SMS_VALIDATOR_VERSION } from "@/lib/v2-human-visible-sms/types";

const DEFAULT_MAX = 320;

export type FinalizePhase5aResult = {
  message: string;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  validationFailed: boolean;
  validatorMode: "enforce" | "shadow_only";
  brainRewriteMs: number | null;
  brainFixMs: number | null;
};

function preservationSatisfied(text: string, snippets: string[]): boolean {
  const lower = text.toLowerCase();
  for (const raw of snippets) {
    const s = raw.trim();
    if (s.length < 8) continue;
    if (!lower.includes(s.toLowerCase())) return false;
  }
  return true;
}

function logPhase5a(args: {
  path: string;
  brainCase: HumanSmsBrainCase;
  sliceFlag: string;
  machineDraftLen: number;
  machineDraftHash: string;
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
  appendSegmentsPresent?: Phase5aBrainContext["appendSegments"];
}) {
  console.info("[human_visible_sms_pipeline]", {
    event: "human_visible_sms_pipeline",
    path: args.path,
    brain_case: args.brainCase,
    phase5a_slice_flag: args.sliceFlag,
    append_segments_present: args.appendSegmentsPresent ?? null,
    machine_draft_len: args.machineDraftLen,
    machine_draft_hash: args.machineDraftHash,
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
    brain_prompt_version: PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION,
    final_len: args.finalText.length,
    final_hash: hashSmsSnippet(args.finalText),
  });
}

async function runPhase5aFinalize(args: {
  path: string;
  sliceFlag: string;
  brainCase: HumanSmsBrainCase;
  channel: HumanVisibleSmsChannel;
  machineDraft: string;
  phase5aContext: Phase5aBrainContext;
  maxChars: number;
  allowVictoryRoomPhrase: boolean;
  brainAllowed: boolean;
  preservationSnippets?: string[];
  curatedFallback: string;
  minimalFallback: string;
}): Promise<FinalizePhase5aResult> {
  const machineDraft0 = args.machineDraft.trim();
  const machineDraftLen = machineDraft0.length;
  const machineDraftHash = hashSmsSnippet(machineDraft0);

  let text = machineDraft0;
  let brainUsed = false;
  let brainFailureReason: string | null = null;
  let fallbackUsed: string | null = null;
  let repairOpenAiAttempted = false;
  let brainRewriteMs: number | null = null;
  let brainFixMs: number | null = null;

  const enforce = isV2HumanVisibleSmsValidatorEnforce();
  const validatorMode: "enforce" | "shadow_only" = enforce ? "enforce" : "shadow_only";
  const brainMasterOn = isV2HumanSmsBrainEnabled();

  if (args.brainAllowed && brainMasterOn) {
    warnIfPhase5aBrainWithoutValidatorEnforce();
  }

  const brainContext: HumanSmsBrainInput["context"] = {
    phase5a: args.phase5aContext,
  };

  const runValidate = (s: string) =>
    validateHumanVisibleSms(s, {
      channel: args.channel,
      maxChars: args.maxChars,
      allowVictoryRoomPhrase: args.allowVictoryRoomPhrase,
    });

  const snippets = (args.preservationSnippets ?? []).map((s) => s.trim()).filter((s) => s.length >= 8);
  const needsPreservation = args.phase5aContext.slice === "stitched_final" && snippets.length > 0;

  if (args.brainAllowed && brainMasterOn) {
    const t0 = performance.now();
    const brain = await rewriteMachineDraftToHumanSms({
      brainCase: args.brainCase,
      machineDraft: text,
      promptVersion: PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION,
      context: brainContext,
      phase5aCreativeTone: true,
    });
    brainRewriteMs = Math.round(performance.now() - t0);
    if (brain.ok) {
      text = brain.message;
      brainUsed = true;
      if (needsPreservation && !preservationSatisfied(text, snippets)) {
        text = machineDraft0;
        fallbackUsed = "preservation_revert_to_machine_draft";
        brainUsed = false;
      }
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
        path: args.path,
        validator_shadow: true,
        phase5a_slice_flag: args.sliceFlag,
        brain_case: args.brainCase,
        validation_ok: false,
        validation_failure_reason: v.reason,
        draft_hash: hashSmsSnippet(text),
      });
    }

    if (!enforce) {
      logPhase5a({
        path: args.path,
        brainCase: args.brainCase,
        sliceFlag: args.sliceFlag,
        machineDraftLen,
        machineDraftHash,
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
        finalText: text,
        appendSegmentsPresent: args.phase5aContext.appendSegments,
      });
      return {
        message: text,
        brainUsed,
        brainFailureReason,
        fallbackUsed: null,
        validationFailed: true,
        validatorMode,
        brainRewriteMs,
        brainFixMs,
      };
    }

    if (brainMasterOn && enforce) {
      repairOpenAiAttempted = true;
      const tFix = performance.now();
      const retry = await rewriteMachineDraftToHumanSms({
        brainCase: args.brainCase,
        machineDraft: `FIX this SMS: remove banned jargon and system words. Preserve every meaning from the original. Original: ${text}`,
        promptVersion: HUMAN_SMS_BRAIN_PROMPT_VERSION,
        context: brainContext,
      });
      brainFixMs = Math.round(performance.now() - tFix);
      if (retry.ok) {
        text = retry.message;
        brainUsed = true;
        if (needsPreservation && !preservationSatisfied(text, snippets)) {
          text = machineDraft0;
          fallbackUsed = "preservation_revert_after_fix";
        }
        v = runValidate(text);
      }
    }

    if (!v.ok) {
      const tryCurated = args.curatedFallback.trim();
      if (runValidate(tryCurated).ok) {
        text = tryCurated;
        fallbackUsed = "curated_phase5a_fallback";
      } else {
        const trimDraft = machineDraft0.slice(0, args.maxChars);
        if (runValidate(trimDraft).ok) {
          text = trimDraft;
          fallbackUsed = "machine_draft_trim";
        } else {
          const minF = args.minimalFallback.trim();
          text = runValidate(minF).ok ? minF : trimDraft;
          fallbackUsed = "minimal_or_machine_draft";
        }
      }
      v = runValidate(text);
    }
  }

  const finalCheck = runValidate(text);
  logPhase5a({
    path: args.path,
    brainCase: args.brainCase,
    sliceFlag: args.sliceFlag,
    machineDraftLen,
    machineDraftHash,
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
    appendSegmentsPresent: args.phase5aContext.appendSegments,
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
  };
}

export function reactivationOutboundCuratedFallback(effectiveAsk: string, behaviorStatement: string): string {
  const raw = (effectiveAsk?.trim() || behaviorStatement?.trim() || "").replace(/\s+/g, " ");
  const snippet = raw.slice(0, 72);
  if (snippet.length >= 10) {
    return `I'm still here—when you're ready, what's one small honest step on ${snippet} today?`;
  }
  return "Still here with you—when you're ready, what's one small honest step you'd take today?";
}

export async function finalizePhase5aReactivationOutboundHumanSms(args: {
  machineDraft: string;
  dailyPurpose: string;
  dailyReplySourcePre: string;
  effectiveAskPreview: string;
  behaviorStatementPreview: string;
  identityAnchorPreview?: string | null;
  coachingMemoryPreview?: string | null;
  recentSmsContextPreview?: string | null;
  effectiveAskForFallback: string;
  behaviorStatementForFallback: string;
  maxChars?: number;
}): Promise<FinalizePhase5aResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const curated = reactivationOutboundCuratedFallback(
    args.effectiveAskForFallback,
    args.behaviorStatementForFallback
  );
  const minimal = "When you're ready, I'm still tracking with you.";

  return runPhase5aFinalize({
    path: "reactivation_outbound",
    sliceFlag: "V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND",
    brainCase: "daily_outbound_reactivation_nudge",
    channel: "reactivation_outbound",
    machineDraft: args.machineDraft,
    maxChars,
    allowVictoryRoomPhrase: false,
    brainAllowed: shouldRunPhase5aReactivationOutboundBrain(),
    preservationSnippets: undefined,
    curatedFallback: curated,
    minimalFallback: minimal,
    phase5aContext: {
      slice: "reactivation_outbound",
      dailyPurpose: args.dailyPurpose,
      dailyReplySourcePre: args.dailyReplySourcePre,
      effectiveAskPreview: args.effectiveAskPreview,
      behaviorPreview: args.behaviorStatementPreview,
    },
  });
}

export async function finalizePhase5aCentralTetherHumanSms(args: {
  machineDraft: string;
  tetherRoute: "normal_accountability" | "blocker_capture";
  centralTurnPurpose: string;
  maxChars?: number;
}): Promise<FinalizePhase5aResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const curated = args.machineDraft.trim();
  const minimal = "What happened with your bar today?";

  return runPhase5aFinalize({
    path: "inbound_central_tether",
    sliceFlag: "V2_HUMAN_SMS_PHASE5A_CENTRAL_TETHER",
    brainCase: "inbound_central_tether_pivot",
    channel: "inbound_central_tether",
    machineDraft: args.machineDraft,
    maxChars,
    allowVictoryRoomPhrase: false,
    brainAllowed: shouldRunPhase5aCentralTetherBrain(),
    preservationSnippets: undefined,
    curatedFallback: curated,
    minimalFallback: minimal,
    phase5aContext: {
      slice: "central_tether",
      tetherRoute: args.tetherRoute,
      centralTurnPurpose: args.centralTurnPurpose,
    },
  });
}

export async function finalizePhase5aArcClarifyHumanSms(args: {
  machineDraft: string;
  tentativeOutcomeLabel: string;
  maxChars?: number;
}): Promise<FinalizePhase5aResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const curated = args.machineDraft.trim();
  const minimal = "Which are you answering—today's check-in, or something else?";

  return runPhase5aFinalize({
    path: "inbound_arc_clarify",
    sliceFlag: "V2_HUMAN_SMS_PHASE5A_ARC_CLARIFY",
    brainCase: "inbound_active_reply_context_clarify",
    channel: "inbound_arc_clarify",
    machineDraft: args.machineDraft,
    maxChars,
    allowVictoryRoomPhrase: false,
    brainAllowed: shouldRunPhase5aArcClarifyBrain(),
    preservationSnippets: undefined,
    curatedFallback: curated,
    minimalFallback: minimal,
    phase5aContext: {
      slice: "arc_clarify",
      centralTurnPurpose: args.tentativeOutcomeLabel,
    },
  });
}

export async function finalizePhase5aInboundStitchedFinalHumanSms(args: {
  machineDraft: string;
  preservationSnippets: string[];
  appendSegments: NonNullable<Phase5aBrainContext["appendSegments"]>;
  allowVictoryRoomPhrase: boolean;
  maxChars?: number;
}): Promise<FinalizePhase5aResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const curated = args.machineDraft.trim();
  const minimal = "Thanks for the honesty—I'm with you on this.";

  return runPhase5aFinalize({
    path: "normal_inbound_stitched_final",
    sliceFlag: "V2_HUMAN_SMS_PHASE5A_INBOUND_STITCHED_FINAL",
    brainCase: "normal_inbound_stitched_final",
    channel: "normal_inbound_stitched_final",
    machineDraft: args.machineDraft,
    maxChars,
    allowVictoryRoomPhrase: args.allowVictoryRoomPhrase,
    brainAllowed: shouldRunPhase5aInboundStitchedFinalBrain(),
    preservationSnippets: args.preservationSnippets,
    curatedFallback: curated,
    minimalFallback: minimal,
    phase5aContext: {
      slice: "stitched_final",
      preservationSnippets: args.preservationSnippets,
      appendSegments: args.appendSegments,
    },
  });
}

/**
 * Phase 4A — Polish standard daily outbound accountability SMS (non–proposal mode).
 * No DB. Cadence / next_move / proposal binding unchanged by this module.
 */

import {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION,
  rewriteMachineDraftToHumanSms,
} from "@/lib/v2-human-sms-brain/human-sms-brain";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import type { HumanSmsBrainInput } from "@/lib/v2-human-sms-brain/types";
import {
  isV2HumanSmsBrainEnabled,
  isV2HumanSmsPhase4DailyOutboundEnabled,
  isV2HumanVisibleSmsValidatorEnforce,
  isV2HumanVisibleSmsValidatorShadow,
  shouldRunPhase4DailyOutboundBrain,
  warnIfPhase4BrainWithoutValidatorEnforce,
} from "@/lib/v2-human-sms-brain/flags";
import { hashSmsSnippet, validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { HUMAN_VISIBLE_SMS_VALIDATOR_VERSION } from "@/lib/v2-human-visible-sms/types";

const DEFAULT_MAX = 320;

export function deriveDailyOutboundBrainCase(serverStrategy: string): HumanSmsBrainCase {
  switch (serverStrategy) {
    case "standard_check":
      return "daily_outbound_standard_check";
    case "recovery_check":
      return "daily_outbound_recovery_check";
    case "reentry_check":
      return "daily_outbound_reentry_check";
    case "blocker_followup":
      return "daily_outbound_blocker_followup";
    default:
      return "daily_outbound_accountability";
  }
}

export function dailyOutboundCuratedFallback(effectiveAsk: string, behaviorStatement: string): string {
  const raw = (effectiveAsk?.trim() || behaviorStatement?.trim() || "").replace(/\s+/g, " ");
  const snippet = raw.slice(0, 88);
  if (snippet.length >= 8) {
    return `Today's check: did you ${snippet}?`;
  }
  return "Today's check-in: did you follow through?";
}

export type FinalizeDailyOutboundHumanSmsResult = {
  message: string;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  validationFailed: boolean;
  validatorMode: "enforce" | "shadow_only";
  brainRewriteMs: number | null;
  brainFixMs: number | null;
};

function logPipeline(args: {
  brainCase: HumanSmsBrainCase;
  dailyReplySourcePre: string;
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
}) {
  console.info("[human_visible_sms_pipeline]", {
    event: "human_visible_sms_pipeline",
    path: "daily_outbound",
    brain_case: args.brainCase,
    daily_reply_source_pre: args.dailyReplySourcePre,
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
    brain_prompt_version: PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION,
    final_len: args.finalText.length,
    final_hash: hashSmsSnippet(args.finalText),
  });
}

export async function finalizeDailyOutboundHumanSms(args: {
  machineDraft: string;
  brainCase: HumanSmsBrainCase;
  dailyPurpose: string;
  serverStrategy: string;
  effectiveAskPreview: string;
  behaviorStatementPreview: string;
  dailyReplySourcePre: string;
  identityAnchorPreview?: string | null;
  coachingMemoryPreview?: string | null;
  recentSmsContextPreview?: string | null;
  effectiveAskForFallback: string;
  behaviorStatementForFallback: string;
  maxChars?: number;
}): Promise<FinalizeDailyOutboundHumanSmsResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  const machineDraft0 = args.machineDraft.trim();
  const machineDraftLen = machineDraft0.length;
  const machineDraftHash = hashSmsSnippet(machineDraft0);

  if (isV2HumanSmsPhase4DailyOutboundEnabled() && isV2HumanSmsBrainEnabled()) {
    warnIfPhase4BrainWithoutValidatorEnforce();
  }

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
  const brainAllowed = shouldRunPhase4DailyOutboundBrain();

  const brainContext: HumanSmsBrainInput["context"] = {
    dailyOutbound: {
      dailyPurpose: args.dailyPurpose,
      serverStrategy: args.serverStrategy,
      effectiveAskPreview: args.effectiveAskPreview,
      behaviorPreview: args.behaviorStatementPreview,
      dailyReplySourcePre: args.dailyReplySourcePre,
      identityAnchorPreview: args.identityAnchorPreview ?? undefined,
      coachingMemoryPreview: args.coachingMemoryPreview ?? undefined,
      recentSmsContextPreview: args.recentSmsContextPreview ?? undefined,
    },
  };

  const runValidate = (s: string) =>
    validateHumanVisibleSms(s, {
      channel: "daily_outbound",
      maxChars,
      allowVictoryRoomPhrase: false,
    });

  if (brainAllowed) {
    const t0 = performance.now();
    const brain = await rewriteMachineDraftToHumanSms({
      brainCase: args.brainCase,
      machineDraft: text,
      promptVersion: PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION,
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
        path: "daily_outbound",
        validator_shadow: true,
        brain_case: args.brainCase,
        daily_reply_source_pre: args.dailyReplySourcePre,
        validation_ok: false,
        validation_failure_reason: v.reason,
        draft_hash: hashSmsSnippet(text),
      });
    }

    if (!enforce) {
      logPipeline({
        brainCase: args.brainCase,
        dailyReplySourcePre: args.dailyReplySourcePre,
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
        machineDraft: `FIX this SMS to remove banned jargon and system words while keeping one clear accountability ask: ${text}`,
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
      const fb = dailyOutboundCuratedFallback(
        args.effectiveAskForFallback,
        args.behaviorStatementForFallback
      );
      const v2 = runValidate(fb);
      if (v2.ok) {
        text = fb;
        fallbackUsed = "curated_daily_outbound_fallback";
      } else {
        const minimal = "Today's check-in: did you follow through?";
        text = runValidate(minimal).ok ? minimal : machineDraft0.slice(0, maxChars);
        fallbackUsed = "minimal_or_machine_draft";
      }
    }
  }

  const finalCheck = runValidate(text);
  logPipeline({
    brainCase: args.brainCase,
    dailyReplySourcePre: args.dailyReplySourcePre,
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

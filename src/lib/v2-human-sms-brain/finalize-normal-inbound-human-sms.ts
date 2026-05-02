/**
 * Phase 2 — Final wording layer for normal inbound coach SMS after resolveV2InboundCoachReplyBody.
 * No Supabase. Does not change events or commitment state.
 */

import {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION,
  rewriteMachineDraftToHumanSms,
} from "@/lib/v2-human-sms-brain/human-sms-brain";
import type { HumanSmsBrainInput } from "@/lib/v2-human-sms-brain/types";
import {
  isV2HumanSmsBrainEnabled,
  isV2HumanSmsPhase2NormalInboundEnabled,
  isV2HumanVisibleSmsValidatorEnforce,
  isV2HumanVisibleSmsValidatorShadow,
  shouldRunPhase2NormalInboundBrain,
} from "@/lib/v2-human-sms-brain/flags";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import { hashSmsSnippet, validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { HUMAN_VISIBLE_SMS_VALIDATOR_VERSION } from "@/lib/v2-human-visible-sms/types";

const DEFAULT_MAX = 300;

const PHASE2_OUTCOME_TRIAD = new Set(["user_yes", "user_no", "user_partial"]);

/** Runtime guard for future schema expansion — do not treat unknown outcomes as partial. */
export function isPhase2KnownOutcomeWriteEventType(ft: string): boolean {
  return PHASE2_OUTCOME_TRIAD.has(ft);
}

/**
 * When server will write an outcome event but the effective type is not yes/no/partial,
 * skip Brain rewrite (keep machine draft). Logs use hashed type only.
 */
export function shouldSkipPhase2BrainForUnknownOutcomeEvent(args: {
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: string;
}): { skip: boolean; outcomeTypeKeyHash: string | null } {
  const d = args.gatedDecision;
  if (!d.should_write_outcome_event) {
    return { skip: false, outcomeTypeKeyHash: null };
  }
  const ft = String(d.final_event_type ?? args.deterministicEventType);
  if (isPhase2KnownOutcomeWriteEventType(ft)) {
    return { skip: false, outcomeTypeKeyHash: null };
  }
  return { skip: true, outcomeTypeKeyHash: hashSmsSnippet(ft) };
}

/** Stable snapshot for tests: Phase 2 must not change server-authoritative inbound state. */
export function snapshotNormalInboundPhase2ServerAuthoritativeState(args: {
  classificationEventType: string;
  gatedDecision: Pick<V2InboundGatedDecision, "mode" | "final_event_type" | "should_write_outcome_event">;
}): {
  classificationEventType: string;
  gatedMode: string;
  finalEventType: string | null;
  shouldWriteOutcome: boolean;
} {
  return {
    classificationEventType: args.classificationEventType,
    gatedMode: args.gatedDecision.mode,
    finalEventType: args.gatedDecision.final_event_type,
    shouldWriteOutcome: args.gatedDecision.should_write_outcome_event,
  };
}

export function deriveNormalInboundBrainCase(args: {
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: V2InboundEventType;
  replyMode: string;
}): HumanSmsBrainCase {
  const d = args.gatedDecision;
  if (!d.should_write_outcome_event) {
    switch (d.mode) {
      case "clarify":
        return "normal_inbound_non_outcome_clarify";
      case "repair_reply_only":
        return "normal_inbound_non_outcome_repair_only";
      case "commitment_change_handoff":
        return "normal_inbound_non_outcome_commitment_change";
      case "soft_opt_out_reply":
        return "normal_inbound_non_outcome_soft_opt";
      default:
        return "normal_inbound_non_outcome_clarify";
    }
  }
  const ft = String(d.final_event_type ?? args.deterministicEventType);
  if (!isPhase2KnownOutcomeWriteEventType(ft)) {
    throw new Error(
      "[phase2] deriveNormalInboundBrainCase: unknown outcome type — check shouldSkipPhase2BrainForUnknownOutcomeEvent first"
    );
  }
  if (args.replyMode === "repair_then_coach") {
    return "normal_inbound_repair_coach";
  }
  if (ft === "user_yes") return "normal_inbound_outcome_yes";
  if (ft === "user_no") return "normal_inbound_outcome_no";
  return "normal_inbound_outcome_partial";
}

/** Curated SMS when validator enforce rejects draft + safe path (must pass validateHumanVisibleSms). */
export function normalInboundCuratedFallbackForCase(brainCase: HumanSmsBrainCase): string {
  switch (brainCase) {
    case "normal_inbound_outcome_yes":
      return "Good—that counts for today. Same standard tomorrow.";
    case "normal_inbound_outcome_no":
      return "Thanks for the honesty. What was the main friction today?";
    case "normal_inbound_outcome_partial":
      return "Got it—honest partial. What pulled you off finishing?";
    case "normal_inbound_non_outcome_clarify":
      return "Say clearly—did you hit the bar today, yes or no?";
    case "normal_inbound_non_outcome_repair_only":
      return "Noted. What happened in one short sentence?";
    case "normal_inbound_non_outcome_commitment_change":
      return "Got it—finish the update in the app when you can.";
    case "normal_inbound_non_outcome_soft_opt":
      return "Understood. Text me when you want accountability again.";
    case "normal_inbound_repair_coach":
      return "Heard you. Stay in the fight—what’s one move tomorrow?";
    default:
      return "Got it.";
  }
}

export type FinalizeNormalInboundHumanSmsResult = {
  message: string;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  validationFailed: boolean;
  validatorMode: "enforce" | "shadow_only";
  brainSkippedReason: "brain_disabled" | null;
  brainRewriteMs: number | null;
  brainFixMs: number | null;
};

function logPipelinePayload(args: {
  brainCase: HumanSmsBrainCase;
  outcomeKeyForLog: string | null;
  brainMasterOn: boolean;
  validatorMode: "enforce" | "shadow_only";
  validationOk: boolean;
  validationFailureReason: string | null;
  bannedHit: string | null;
  brainUsed: boolean;
  brainFailureReason: string | null;
  fallbackUsed: string | null;
  repairOpenAiAttempted: boolean;
  finalText: string;
  brainSkippedReason: "brain_disabled" | null;
  brainRewriteMs: number | null;
  brainFixMs: number | null;
}) {
  console.info("[human_visible_sms_pipeline]", {
    event: "human_visible_sms_pipeline",
    path: "normal_inbound",
    phase2_flag: process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND === "true",
    brain_case: args.brainCase,
    outcome_key_hash: args.outcomeKeyForLog ? hashSmsSnippet(args.outcomeKeyForLog) : null,
    brain_enabled: args.brainMasterOn,
    brain_skipped_reason: args.brainSkippedReason,
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
    brain_prompt_version: PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION,
    final_len: args.finalText.length,
    final_hash: hashSmsSnippet(args.finalText),
  });
}

export async function finalizeNormalInboundHumanSms(args: {
  machineDraft: string;
  brainCase: HumanSmsBrainCase;
  brainContext?: HumanSmsBrainInput["context"];
  maxChars?: number;
  outcomeKeyForLog?: string | null;
}): Promise<FinalizeNormalInboundHumanSmsResult> {
  const maxChars = args.maxChars ?? DEFAULT_MAX;
  let text = args.machineDraft.trim();
  let brainUsed = false;
  let brainFailureReason: string | null = null;
  let fallbackUsed: string | null = null;
  let repairOpenAiAttempted = false;

  const enforce = isV2HumanVisibleSmsValidatorEnforce();
  const validatorMode: "enforce" | "shadow_only" = enforce ? "enforce" : "shadow_only";
  const brainAllowed = shouldRunPhase2NormalInboundBrain();
  const brainMasterOn = isV2HumanSmsBrainEnabled();
  const phase2SliceOn = isV2HumanSmsPhase2NormalInboundEnabled();
  const brainSkippedReason: "brain_disabled" | null =
    phase2SliceOn && !brainAllowed ? "brain_disabled" : null;

  let brainRewriteMs: number | null = null;
  let brainFixMs: number | null = null;

  const runValidate = (s: string) =>
    validateHumanVisibleSms(s, {
      channel: "normal_inbound",
      maxChars,
      allowVictoryRoomPhrase: false,
    });

  if (brainAllowed) {
    const t0 = performance.now();
    const brain = await rewriteMachineDraftToHumanSms({
      brainCase: args.brainCase,
      machineDraft: text,
      promptVersion: PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION,
      context: args.brainContext,
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
        path: "normal_inbound",
        validator_shadow: true,
        validation_ok: false,
        validation_failure_reason: v.reason,
        draft_len: text.length,
        draft_hash: hashSmsSnippet(text),
        brain_case: args.brainCase,
      });
    }

    if (!enforce) {
      logPipelinePayload({
        brainCase: args.brainCase,
        outcomeKeyForLog: args.outcomeKeyForLog ?? null,
        brainMasterOn,
        validatorMode,
        validationOk: false,
        validationFailureReason: v.reason,
        bannedHit: "bannedTerm" in v ? v.bannedTerm ?? null : null,
        brainUsed,
        brainFailureReason,
        fallbackUsed: null,
        repairOpenAiAttempted: false,
        finalText: text,
        brainSkippedReason,
        brainRewriteMs,
        brainFixMs,
      });
      return {
        message: text,
        brainUsed,
        brainFailureReason,
        fallbackUsed: null,
        validationFailed: true,
        validatorMode,
        brainSkippedReason,
        brainRewriteMs,
        brainFixMs,
      };
    }

    if (brainMasterOn && enforce) {
      repairOpenAiAttempted = true;
      const tFix = performance.now();
      const retry = await rewriteMachineDraftToHumanSms({
        brainCase: args.brainCase,
        machineDraft: `FIX this SMS to remove banned jargon and system words while keeping meaning: ${text}`,
        promptVersion: HUMAN_SMS_BRAIN_PROMPT_VERSION,
        context: args.brainContext,
      });
      brainFixMs = Math.round(performance.now() - tFix);
      if (retry.ok) {
        text = retry.message;
        brainUsed = true;
        v = runValidate(text);
      }
    }

    if (!v.ok) {
      const fb = normalInboundCuratedFallbackForCase(args.brainCase);
      const v2 = runValidate(fb);
      if (v2.ok) {
        text = fb;
        fallbackUsed = "curated_fallback_for_case";
      } else {
        const minimal = "Got it.";
        text = runValidate(minimal).ok ? minimal : args.machineDraft.trim().slice(0, maxChars);
        fallbackUsed = "minimal_or_machine_draft";
      }
    }
  }

  const finalCheck = runValidate(text);
  logPipelinePayload({
    brainCase: args.brainCase,
    outcomeKeyForLog: args.outcomeKeyForLog ?? null,
    brainMasterOn,
    validatorMode,
    validationOk: finalCheck.ok,
    validationFailureReason: finalCheck.ok ? null : finalCheck.reason,
    bannedHit: finalCheck.ok ? null : ("bannedTerm" in finalCheck ? finalCheck.bannedTerm ?? null : null),
    brainUsed,
    brainFailureReason,
    fallbackUsed,
    repairOpenAiAttempted,
    finalText: text,
    brainSkippedReason,
    brainRewriteMs,
    brainFixMs,
  });

  return {
    message: text,
    brainUsed,
    brainFailureReason,
    fallbackUsed,
    validationFailed,
    validatorMode,
    brainSkippedReason,
    brainRewriteMs,
    brainFixMs,
  };
}

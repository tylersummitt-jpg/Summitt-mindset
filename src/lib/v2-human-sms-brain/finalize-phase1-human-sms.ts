/**
 * Phase 1 orchestrator: machine draft → optional Brain → validateHumanVisibleSms.
 * No Supabase. Callers own Twilio and DB.
 */

import { HUMAN_SMS_BRAIN_PROMPT_VERSION, rewriteMachineDraftToHumanSms } from "@/lib/v2-human-sms-brain/human-sms-brain";
import {
  isV2HumanSmsBrainEnabled,
  isV2HumanVisibleSmsValidatorEnforce,
  isV2HumanVisibleSmsValidatorShadow,
} from "@/lib/v2-human-sms-brain/flags";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import { hashSmsSnippet, validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { HUMAN_VISIBLE_SMS_VALIDATOR_VERSION } from "@/lib/v2-human-visible-sms/types";
import type { HumanVisibleSmsChannel } from "@/lib/v2-human-visible-sms/types";
import { COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION } from "@/lib/v2-commitment-meaning-interpreter/types";

export type FinalizePhase1HumanSmsArgs = {
  path: "pending_resolution" | "contract_consent";
  brainCase: HumanSmsBrainCase;
  machineDraft: string;
  channel: HumanVisibleSmsChannel;
  maxChars?: number;
  allowVictoryRoomPhrase?: boolean;
  brainContext?: {
    currentBarSummary?: string | null;
    preferredName?: string | null;
    proposalSummary?: string | null;
    contractKindHint?: "shrink_ask" | "recommit_same" | null;
  };
  /** Curated safe string if all else fails (must pass validator offline). */
  safeFallback: string;
};

export type FinalizePhase1HumanSmsResult = {
  message: string;
  brainUsed: boolean;
  validatorEnforced: boolean;
  validationFailed: boolean;
  fallbackUsed: string | null;
  brainFailureReason: string | null;
};

/** Curated Phase 1 strings when machine draft + safeFallback fail validation (exported for tests). */
export function phase1CuratedFallbackForCase(brainCase: HumanSmsBrainCase): string {
  switch (brainCase) {
    case "contract_consent_overlay_yes_ack":
      return "Got it. I’ll match tomorrow’s text to what you agreed.";
    case "contract_consent_overlay_no_ack":
      return "Okay—no change. We keep the same ask tomorrow.";
    case "pending_resolution_confirmation_prompt":
      return "Does that bar feel right? Tell me straight what you want held.";
    case "pending_resolution_replace_applied":
      return "Got it. I’ll hold you to that starting tomorrow.";
    case "pending_resolution_tighten_applied":
      return "Got it. I’ll hold you to the simpler ask tomorrow.";
    case "pending_resolution_clarify_candidate":
      return "What exactly should I hold you to tomorrow? One clear daily action.";
    case "pending_resolution_ambiguous_confirm":
      return "Does that lock it for you—or tell me what you want instead.";
    case "pending_resolution_no_problem_reenter":
      return "What would work better? Send one clear daily action.";
    case "pending_resolution_lost_candidate":
      return "What exactly should I hold you to tomorrow? One clear action.";
    case "pending_resolution_rpc_error_hold":
      return "I couldn’t save that from here—your wording is still noted. Try again or say it shorter.";
    case "pending_resolution_vague_need_detail":
      return "I need one clear daily action. What exactly should I hold you to tomorrow?";
    case "pending_resolution_unsafe_candidate":
      return "Summitt Mindset cannot help with that request. Send me a safe daily commitment and we'll work from there.";
    default:
      return "Got it.";
  }
}

export async function finalizePhase1HumanSms(
  args: FinalizePhase1HumanSmsArgs
): Promise<FinalizePhase1HumanSmsResult> {
  const maxChars = args.maxChars ?? 320;
  let text = args.machineDraft.trim();
  let brainUsed = false;
  let brainFailureReason: string | null = null;
  let fallbackUsed: string | null = null;
  let repairOpenAiAttempted = false;

  const runValidate = (s: string) =>
    validateHumanVisibleSms(s, {
      channel: args.channel,
      maxChars,
      allowVictoryRoomPhrase: args.allowVictoryRoomPhrase,
    });

  const brainEnabled = isV2HumanSmsBrainEnabled();

  if (isV2HumanVisibleSmsValidatorShadow()) {
    const shadow = runValidate(text);
    if (!shadow.ok) {
      console.info("[human_visible_sms_pipeline]", {
        event: "human_visible_sms_pipeline",
        path: args.path,
        case: args.brainCase,
        validator_shadow: true,
        validation_ok: false,
        validation_reason: shadow.ok ? null : shadow.reason,
        draft_len: text.length,
        draft_hash: hashSmsSnippet(text),
      });
    }
  }

  if (brainEnabled) {
    const brain = await rewriteMachineDraftToHumanSms({
      brainCase: args.brainCase,
      machineDraft: text,
      promptVersion: HUMAN_SMS_BRAIN_PROMPT_VERSION,
      context: args.brainContext,
    });
    if (brain.ok) {
      text = brain.message;
      brainUsed = true;
    } else {
      brainFailureReason = brain.reason;
    }
  }

  const enforce = isV2HumanVisibleSmsValidatorEnforce();
  let validationFailed = false;

  if (enforce) {
    let v = runValidate(text);
    if (!v.ok) {
      validationFailed = true;
      if (brainEnabled) {
        repairOpenAiAttempted = true;
        const retry = await rewriteMachineDraftToHumanSms({
          brainCase: args.brainCase,
          machineDraft: `FIX this SMS to remove banned jargon and system words while keeping meaning: ${text}`,
          promptVersion: HUMAN_SMS_BRAIN_PROMPT_VERSION,
          context: args.brainContext,
        });
        if (retry.ok) {
          text = retry.message;
          brainUsed = true;
          v = runValidate(text);
        }
      }
      if (!v.ok) {
        const fb = args.safeFallback;
        const v2 = runValidate(fb);
        if (v2.ok) {
          text = fb;
          fallbackUsed = "safe_fallback_arg";
        } else {
          const fb3 = phase1CuratedFallbackForCase(args.brainCase);
          const v3 = runValidate(fb3);
          text = v3.ok ? fb3 : "Got it.";
          fallbackUsed = v3.ok ? "curated_fallback_for_case" : "minimal_got_it";
        }
      }
    }
  }

  const finalCheck = runValidate(text);

  console.info("[human_visible_sms_pipeline]", {
    event: "human_visible_sms_pipeline",
    path: args.path,
    case: args.brainCase,
    interpreter_enabled: process.env.V2_COMMITMENT_MEANING_INTERPRETER_ENABLED === "true",
    commitment_interpreter_prompt_version: COMMITMENT_MEANING_INTERPRETER_PROMPT_VERSION,
    brain_enabled: brainEnabled,
    brain_skipped_reason: brainEnabled ? null : "brain_disabled",
    validator_enforce: enforce,
    validator_shadow: isV2HumanVisibleSmsValidatorShadow(),
    validator_version: HUMAN_VISIBLE_SMS_VALIDATOR_VERSION,
    brain_prompt_version: HUMAN_SMS_BRAIN_PROMPT_VERSION,
    repair_openai_attempted: repairOpenAiAttempted,
    validation_ok: finalCheck.ok,
    validation_reason: finalCheck.ok ? null : finalCheck.reason,
    banned_hit: finalCheck.ok ? null : ("bannedTerm" in finalCheck ? finalCheck.bannedTerm : null),
    brain_failure_reason: brainFailureReason,
    fallback_used: fallbackUsed,
    brain_used: brainUsed,
    final_len: text.length,
    final_hash: hashSmsSnippet(text),
  });

  return {
    message: text,
    brainUsed,
    validatorEnforced: enforce,
    validationFailed,
    fallbackUsed,
    brainFailureReason,
  };
}

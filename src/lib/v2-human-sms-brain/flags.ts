/**
 * Phase 1 Human SMS umbrella flags (env). Defaults preserve legacy behavior (all off/false).
 */

export function isV2CommitmentMeaningInterpreterEnabled(): boolean {
  return process.env.V2_COMMITMENT_MEANING_INTERPRETER_ENABLED === "true";
}

export function isV2HumanSmsBrainEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_BRAIN_ENABLED === "true";
}

export function isV2HumanVisibleSmsValidatorEnforce(): boolean {
  return process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE === "true";
}

export function isV2HumanVisibleSmsValidatorShadow(): boolean {
  return process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW === "true";
}

export function isV2PendingResolutionVictoryCalloutAllowed(): boolean {
  return process.env.V2_PENDING_RESOLUTION_VICTORY_CALLOUT_ALLOWED === "true";
}

/** Legacy unless explicitly set true (narrow Phase 1 slice). */
export function isV2HumanSmsPhase1PendingResolutionEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE1_PENDING_RESOLUTION === "true";
}

/** Legacy unless explicitly set true (narrow Phase 1 slice). */
export function isV2HumanSmsPhase1ContractConsentEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE1_CONTRACT_CONSENT === "true";
}

/** Interpreter runs only when global + phase slice + interpreter flag. */
export function shouldRunCommitmentInterpreterForPendingResolution(): boolean {
  return (
    isV2HumanSmsPhase1PendingResolutionEnabled() &&
    isV2CommitmentMeaningInterpreterEnabled()
  );
}

/** Brain + validator pipeline for pending resolution replies. */
export function shouldRunHumanSmsPipelineForPendingResolution(): boolean {
  return (
    isV2HumanSmsPhase1PendingResolutionEnabled() &&
    (isV2HumanSmsBrainEnabled() || isV2HumanVisibleSmsValidatorEnforce())
  );
}

export function shouldRunHumanSmsPipelineForContractConsent(): boolean {
  return (
    isV2HumanSmsPhase1ContractConsentEnabled() &&
    (isV2HumanSmsBrainEnabled() || isV2HumanVisibleSmsValidatorEnforce())
  );
}

/** Phase 2 — normal inbound coach reply wording (requires master Brain flag). */
export function isV2HumanSmsPhase2NormalInboundEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND === "true";
}

/** Brain rewrite for normal inbound after resolveV2InboundCoachReplyBody. */
export function shouldRunPhase2NormalInboundBrain(): boolean {
  return isV2HumanSmsBrainEnabled() && isV2HumanSmsPhase2NormalInboundEnabled();
}

/**
 * Phase 2 production North Star: Brain + validator enforce.
 * Warn once per request path when Brain is on but enforce is off (staging-only OK).
 */
export function warnIfPhase2BrainWithoutValidatorEnforce(): void {
  if (
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND === "true" &&
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED === "true" &&
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE !== "true"
  ) {
    console.warn("[human_visible_sms_pipeline]", {
      event: "phase2_production_config_warning",
      warning: "phase2_brain_without_validator_enforce",
      hint: "Set V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE=true for production-quality Phase 2.",
    });
  }
}

/** Phase 3A — outbound adaptive proposal template humanization (shrink / recommit SMS body only). */
export function isV2HumanSmsPhase3AdaptiveProposalEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL === "true";
}

export function shouldRunPhase3AdaptiveProposalBrain(): boolean {
  return isV2HumanSmsBrainEnabled() && isV2HumanSmsPhase3AdaptiveProposalEnabled();
}

export function warnIfPhase3BrainWithoutValidatorEnforce(): void {
  if (
    process.env.V2_HUMAN_SMS_PHASE3_ADAPTIVE_PROPOSAL === "true" &&
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED === "true" &&
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE !== "true"
  ) {
    console.warn("[human_visible_sms_pipeline]", {
      event: "phase3a_production_config_warning",
      warning: "phase3a_brain_without_validator_enforce",
      hint: "Set V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE=true for production-quality Phase 3A proposal SMS.",
    });
  }
}

/** Phase 4A — standard daily outbound accountability SMS polish (not proposal mode). */
export function isV2HumanSmsPhase4DailyOutboundEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND === "true";
}

export function shouldRunPhase4DailyOutboundBrain(): boolean {
  return isV2HumanSmsBrainEnabled() && isV2HumanSmsPhase4DailyOutboundEnabled();
}

/**
 * When false, resolveV2DailyOutboundSmsBody skips Human SMS Brain polish.
 * Reactivation uses the same resolver but is not standard daily accountability copy.
 */
export function shouldApplyPhase4DailyOutboundPolish(
  contractProposalMode: boolean,
  serverStrategy: string
): boolean {
  if (contractProposalMode) return false;
  if (serverStrategy === "reactivation_nudge") return false;
  return shouldRunPhase4DailyOutboundBrain();
}

export function warnIfPhase4BrainWithoutValidatorEnforce(): void {
  if (
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND === "true" &&
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED === "true" &&
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE !== "true"
  ) {
    console.warn("[human_visible_sms_pipeline]", {
      event: "phase4a_production_config_warning",
      warning: "phase4a_brain_without_validator_enforce",
      hint: "Set V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE=true for production-quality Phase 4A daily outbound.",
    });
  }
}

/** Phase 5A umbrella — human polish for reactivation, tether, ARC, stitched inbound (wording only). */
export function isV2HumanSmsPhase5aEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE5A_ENABLED === "true";
}

export function isV2HumanSmsPhase5aReactivationOutboundEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND === "true";
}

export function isV2HumanSmsPhase5aCentralTetherEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE5A_CENTRAL_TETHER === "true";
}

export function isV2HumanSmsPhase5aArcClarifyEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE5A_ARC_CLARIFY === "true";
}

export function isV2HumanSmsPhase5aInboundStitchedFinalEnabled(): boolean {
  return process.env.V2_HUMAN_SMS_PHASE5A_INBOUND_STITCHED_FINAL === "true";
}

export function shouldRunPhase5aReactivationOutboundBrain(): boolean {
  return (
    isV2HumanSmsBrainEnabled() &&
    isV2HumanSmsPhase5aEnabled() &&
    isV2HumanSmsPhase5aReactivationOutboundEnabled()
  );
}

export function shouldRunPhase5aCentralTetherBrain(): boolean {
  return (
    isV2HumanSmsBrainEnabled() &&
    isV2HumanSmsPhase5aEnabled() &&
    isV2HumanSmsPhase5aCentralTetherEnabled()
  );
}

export function shouldRunPhase5aArcClarifyBrain(): boolean {
  return (
    isV2HumanSmsBrainEnabled() &&
    isV2HumanSmsPhase5aEnabled() &&
    isV2HumanSmsPhase5aArcClarifyEnabled()
  );
}

export function shouldRunPhase5aInboundStitchedFinalBrain(): boolean {
  return (
    isV2HumanSmsBrainEnabled() &&
    isV2HumanSmsPhase5aEnabled() &&
    isV2HumanSmsPhase5aInboundStitchedFinalEnabled()
  );
}

/** Reactivation polish runs only for reactivation strategy when Brain + Phase 5A master + slice flag are on. */
export function shouldApplyPhase5aReactivationOutboundPolish(serverStrategy: string): boolean {
  return serverStrategy === "reactivation_nudge" && shouldRunPhase5aReactivationOutboundBrain();
}

export function warnIfPhase5aBrainWithoutValidatorEnforce(): void {
  if (!isV2HumanSmsBrainEnabled() || !isV2HumanSmsPhase5aEnabled()) return;
  if (process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE === "true") return;
  const anySlice =
    isV2HumanSmsPhase5aReactivationOutboundEnabled() ||
    isV2HumanSmsPhase5aCentralTetherEnabled() ||
    isV2HumanSmsPhase5aArcClarifyEnabled() ||
    isV2HumanSmsPhase5aInboundStitchedFinalEnabled();
  if (!anySlice) return;
  console.warn("[human_visible_sms_pipeline]", {
    event: "phase5a_production_config_warning",
    warning: "phase5a_brain_without_validator_enforce",
    hint: "Set V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE=true for production-quality Phase 5A.",
  });
}

/**
 * SoB onboarding tiered validation (pass | warn | block).
 */

import {
  isObviousVagueBehaviorStatement,
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
} from "@/lib/v2-commitment-intake-validation";
import {
  isRelationshipOnlyIdentityAnchorStub,
  normalizeIdentityAnchorText,
  validateOnboardingIdentityAnchorInput,
} from "@/lib/v2-identity-anchor-validation";
import { evaluateTextSafetyTier, mergeSafetyTiers, type IntakeSafetyResult } from "@/lib/onboarding-input-safety";

export type TieredValidation = {
  tier: "pass" | "warn" | "block";
  error?: string;
  warnReason?: string;
};

export function validateOtherTextTiered(raw: unknown): TieredValidation {
  const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!text) {
    return { tier: "pass" };
  }
  const safety = evaluateTextSafetyTier(text);
  if (safety.tier === "block") {
    return { tier: "block", error: safety.reason };
  }
  return { tier: "pass" };
}

export function validatePreferredNameTiered(raw: unknown): TieredValidation {
  const name =
    typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    return { tier: "block", error: "Add what Coach Pat should call you." };
  }
  if (name.length > 80) {
    return { tier: "block", error: "Keep your name shorter." };
  }
  return mergeSafetyTiers(evaluateTextSafetyTier(name)).tier === "block"
    ? { tier: "block", error: evaluateTextSafetyTier(name).reason }
    : { tier: "pass" };
}

export function validateIdentityAnchorTiered(
  raw: unknown,
  options?: { intakeWeakAccept?: boolean }
): TieredValidation {
  const safety = evaluateTextSafetyTier(typeof raw === "string" ? raw : "");
  if (safety.tier === "block") {
    return { tier: "block", error: safety.reason };
  }

  const base = validateOnboardingIdentityAnchorInput(raw);
  if (!base.ok) {
    const normalized = normalizeIdentityAnchorText(raw);
    if (normalized && normalized.length < 12) {
      if (options?.intakeWeakAccept) {
        return { tier: "warn", warnReason: "short_identity" };
      }
      return { tier: "block", error: base.error };
    }
    if (
      normalized &&
      isRelationshipOnlyIdentityAnchorStub(normalized.toLowerCase())
    ) {
      return { tier: "block", error: base.error };
    }
    return { tier: "block", error: base.error };
  }

  const lower = base.normalized.toLowerCase();
  if (
    /\b(best version|best me|better person|better man|better woman)\b/.test(lower)
  ) {
    if (options?.intakeWeakAccept) {
      return { tier: "warn", warnReason: "generic_identity" };
    }
    return {
      tier: "warn",
      warnReason: "generic_identity",
      error: "Try something more specific about who you are becoming.",
    };
  }

  return { tier: "pass" };
}

export function validateGoalTitleTiered(
  raw: string,
  options?: { intakeWeakAccept?: boolean }
): TieredValidation {
  const safety = evaluateTextSafetyTier(raw);
  if (safety.tier === "block") {
    return { tier: "block", error: safety.reason };
  }

  const err = validateCommitmentTitleIntake(raw);
  if (err) {
    return { tier: "block", error: err };
  }

  const t = normalizeIntakeWhitespace(raw).toLowerCase();
  if (/\b(weekly|every week|once a week)\b/.test(t)) {
    if (options?.intakeWeakAccept) {
      return { tier: "warn", warnReason: "weekly_goal" };
    }
    return {
      tier: "warn",
      warnReason: "weekly_goal",
      error: "Coach Pat checks daily. Pick something you can answer yes/no each day.",
    };
  }

  return { tier: "pass" };
}

export function validateGoalBehaviorTiered(
  raw: string,
  options?: { intakeWeakAccept?: boolean }
): TieredValidation {
  const safety = evaluateTextSafetyTier(raw);
  if (safety.tier === "block") {
    return { tier: "block", error: safety.reason };
  }

  const err = validateBehaviorStatementIntake(raw);
  if (err) {
    if (isObviousVagueBehaviorStatement(raw)) {
      if (options?.intakeWeakAccept) {
        return { tier: "warn", warnReason: "vague_goal" };
      }
      return { tier: "warn", warnReason: "vague_goal", error: err };
    }
    return { tier: "block", error: err };
  }

  const b = normalizeIntakeWhitespace(raw).toLowerCase();
  if (/\b(be a better|become a better|better person|better version)\b/.test(b)) {
    if (options?.intakeWeakAccept) {
      return { tier: "warn", warnReason: "identity_like_goal" };
    }
    return {
      tier: "warn",
      warnReason: "identity_like_goal",
      error: "Write the actual daily behavior Coach Pat should check on.",
    };
  }

  if (/\b(weekly|every week|once a week)\b/.test(b)) {
    if (options?.intakeWeakAccept) {
      return { tier: "warn", warnReason: "weekly_goal" };
    }
    return {
      tier: "warn",
      warnReason: "weekly_goal",
      error: "Coach Pat checks daily. Write what you will do today.",
    };
  }

  if (b.length < 25 && !options?.intakeWeakAccept) {
    return {
      tier: "warn",
      warnReason: "hard_to_measure",
      error: "Make this a little more specific so Coach Pat knows what to check on.",
    };
  }

  return { tier: "pass" };
}

export function requireWeakAcceptForWarn(
  tiered: TieredValidation,
  intakeWeakAccept: boolean
): TieredValidation {
  if (tiered.tier === "warn" && !intakeWeakAccept) {
    return tiered;
  }
  if (tiered.tier === "warn" && intakeWeakAccept) {
    return { tier: "pass", warnReason: tiered.warnReason };
  }
  return tiered;
}

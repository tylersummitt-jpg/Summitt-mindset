/**
 * Tiered onboarding intake safety (pass | warn | block).
 */

import { lexicalSafetyPass } from "@/lib/ai-safety";

export type IntakeSafetyTier = "pass" | "warn" | "block";

export type IntakeSafetyResult = {
  tier: IntakeSafetyTier;
  reason?: string;
};

const CRISIS_PATTERNS = [
  /\b(kill myself|suicide|end my life|want to die)\b/i,
  /\b(hurt myself|self[- ]?harm)\b/i,
  /\b(hurt someone|kill (him|her|them))\b/i,
];

const BRAND_DAMAGE_PATTERNS = [
  /\bpat summitt\b/i,
  /\bsummitt mindset\b/i,
];

export function evaluateTextSafetyTier(text: string): IntakeSafetyResult {
  const t = (text || "").trim();
  if (!t) {
    return { tier: "block", reason: "This field is required." };
  }

  for (const rx of CRISIS_PATTERNS) {
    if (rx.test(t)) {
      return {
        tier: "block",
        reason:
          "If you are in crisis, please contact a qualified professional or emergency services. Summitt Mindset cannot help with this here.",
      };
    }
  }

  if (!lexicalSafetyPass(t)) {
    return {
      tier: "block",
      reason: "Please keep this focused on leadership, discipline, and standards.",
    };
  }

  for (const rx of BRAND_DAMAGE_PATTERNS) {
    if (rx.test(t)) {
      return {
        tier: "block",
        reason: "Please write this in your own words without referencing the brand.",
      };
    }
  }

  return { tier: "pass" };
}

export function mergeSafetyTiers(
  ...results: IntakeSafetyResult[]
): IntakeSafetyResult {
  for (const r of results) {
    if (r.tier === "block") return r;
  }
  for (const r of results) {
    if (r.tier === "warn") return r;
  }
  return { tier: "pass" };
}

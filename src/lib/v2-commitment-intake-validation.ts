/**
 * Shared validation for commitment title + behavior_statement intake
 * (onboarding proposed + cutover repair). No DB access.
 */

export const V2_COMMITMENT_INTAKE_TITLE_MAX = 200;
export const V2_COMMITMENT_INTAKE_BEHAVIOR_MAX = 4000;
export const V2_COMMITMENT_INTAKE_SUCCESS_MAX = 2000;
/** Minimum length for behavior after trim/collapse (vague-only phrases handled separately). */
export const V2_COMMITMENT_INTAKE_BEHAVIOR_MIN = 15;

const VAGUE_BEHAVIOR_PHRASES = new Set([
  "be better",
  "do better",
  "get better",
  "get healthy",
  "be healthier",
  "work harder",
  "try harder",
  "stay focused",
  "be disciplined",
]);

export function normalizeIntakeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Lowercase + trim trailing punctuation for exact-match vague list only. */
export function normalizeForVagueBehaviorCheck(behavior: string): string {
  let s = normalizeIntakeWhitespace(behavior).toLowerCase();
  s = s.replace(/[.!?,;:]+$/g, "").trim();
  return s;
}

export function isObviousVagueBehaviorStatement(behavior: string): boolean {
  const n = normalizeForVagueBehaviorCheck(behavior);
  if (!n) return false;
  return VAGUE_BEHAVIOR_PHRASES.has(n);
}

/** null = valid */
export function validateCommitmentTitleIntake(title: string): string | null {
  const t = normalizeIntakeWhitespace(title);
  if (!t) {
    return "Add a short name for this commitment.";
  }
  if (t.length > V2_COMMITMENT_INTAKE_TITLE_MAX) {
    return "Keep this shorter so it works well by text.";
  }
  return null;
}

/** null = valid */
export function validateBehaviorStatementIntake(behavior: string): string | null {
  const b = normalizeIntakeWhitespace(behavior);
  if (!b) {
    return "Add the actual behavior Coach Pat should check on.";
  }
  if (isObviousVagueBehaviorStatement(b)) {
    return "Make this more specific. Write the actual behavior Coach Pat should check on.";
  }
  if (b.length < V2_COMMITMENT_INTAKE_BEHAVIOR_MIN) {
    return "Make this a little more specific so Coach Pat knows what to check on.";
  }
  if (b.length > V2_COMMITMENT_INTAKE_BEHAVIOR_MAX) {
    return "Keep this shorter so it works well by text.";
  }
  return null;
}

/** For optional success_criteria body (cutover / legacy onboarding). null = valid. */
export function validateSuccessCriteriaIntake(success: string | null): string | null {
  if (success == null || success === "") return null;
  const s = normalizeIntakeWhitespace(success);
  if (!s) return null;
  if (s.length > V2_COMMITMENT_INTAKE_SUCCESS_MAX) {
    return "Keep this shorter so it works well by text.";
  }
  return null;
}

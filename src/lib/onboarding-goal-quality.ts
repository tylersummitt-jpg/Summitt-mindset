/**
 * Quality guard for onboarding goal recommendations (deterministic + OpenAI).
 */

export type GoalOptionCandidate = {
  title?: string;
  behaviorStatement?: string;
};

const REJECT_PATTERNS = [
  /\bmatches who i am becoming\b/i,
  /\blife_desires\b/i,
  /\bmy why\b/i,
  /\bneeds_why\b/i,
  /\bpurpose statement\b/i,
  /\bbe better\b/i,
  /\bstay consistent\b/i,
  /\bwork on discipline\b/i,
  /\bbecome a better\b/i,
  /\bimprove my business\b/i,
  /\bdo something for my family\b/i,
];

const STANDALONE_LOWERCASE_I = /\s i \s/i;

export function normalizeGoalOptionText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidRecommendedGoalOption(
  candidate: GoalOptionCandidate,
  identityAnchor = ""
): boolean {
  const title = normalizeGoalOptionText(candidate.title ?? "");
  const behavior = normalizeGoalOptionText(candidate.behaviorStatement ?? "");

  if (!title || !behavior) return false;
  if (title.length > 120 || behavior.length > 320) return false;
  if (!/^I will\b/i.test(behavior)) return false;
  if (STANDALONE_LOWERCASE_I.test(` ${behavior} `)) return false;
  if (behavior.endsWith("—") || behavior.endsWith("-")) return false;
  if (/\.\.\.$/.test(behavior) || behavior.includes("…")) return false;

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(behavior) || pattern.test(title)) return false;
  }

  const anchor = normalizeGoalOptionText(identityAnchor);
  if (anchor.length >= 40 && behavior.toLowerCase().includes(anchor.toLowerCase())) {
    return false;
  }
  if (anchor.length >= 24) {
    const anchorWords = anchor.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const behaviorLower = behavior.toLowerCase();
    const pasted = anchorWords.filter((w) => behaviorLower.includes(w));
    if (pasted.length >= Math.min(6, anchorWords.length)) return false;
  }

  return true;
}

export function sanitizeGoalOptions<T extends GoalOptionCandidate>(
  options: T[],
  identityAnchor = "",
  limit = 5
): { title: string; behaviorStatement: string }[] {
  const out: { title: string; behaviorStatement: string }[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    if (!isValidRecommendedGoalOption(option, identityAnchor)) continue;
    const title = normalizeGoalOptionText(option.title ?? "");
    const behaviorStatement = normalizeGoalOptionText(option.behaviorStatement ?? "");
    const key = `${title}|${behaviorStatement}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, behaviorStatement });
    if (out.length >= limit) break;
  }

  return out;
}

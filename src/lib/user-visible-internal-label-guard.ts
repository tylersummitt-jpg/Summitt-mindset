/**
 * Detect internal accountability / engineering labels leaking into user-visible SMS.
 * Server enums stay internal — visible copy must use human language.
 */

export type UserVisibleInternalLabelViolation = {
  reason: string;
  matched: string;
};

const INTERNAL_LABEL_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: "internal_label_user_yes", re: /\buser_yes\b/i },
  { reason: "internal_label_user_no", re: /\buser_no\b/i },
  { reason: "internal_label_user_partial", re: /\buser_partial\b/i },
  { reason: "internal_label_classification", re: /\bclassification\b/i },
  { reason: "internal_label_classifier", re: /\bclassifier\b/i },
  { reason: "internal_label_event_type", re: /\bevent_type\b/i },
  { reason: "internal_label_route", re: /\broute_(purpose|kind)\b/i },
  { reason: "internal_label_yes_no_partial_menu", re: /\byes\s*\/\s*no\s*\/\s*partial\b/i },
  { reason: "internal_label_yes_no_or_partial", re: /\byes\s*,\s*no\s*,\s*(or\s*)?partial\b/i },
  { reason: "internal_label_yes_no_partial_commas", re: /\byes\s*,\s*no\s*,\s*partial\b/i },
  { reason: "internal_label_yes_no_or_partial_spaces", re: /\byes\s+no\s+or\s+partial\b/i },
  { reason: "internal_label_yes_comma_partial", re: /\byes\s*,\s*partial\b/i },
  { reason: "internal_label_yes_partial_not_yet", re: /\byes\s*,\s*partial\s*,\s*or\s*not\s+yet\b/i },
  { reason: "internal_label_protected_partial_missed", re: /\bprotected\s*,\s*partial\s*,\s*or\s*missed\b/i },
  { reason: "internal_label_done_partial_missed", re: /\bdone\s*,\s*partial\s*,\s*or\s*missed\b/i },
  { reason: "internal_label_done_missed_or_partial", re: /\bdone\s*,\s*missed\s*,\s*or\s*partial\b/i },
  {
    reason: "internal_label_done_partial_or_missed_menu",
    re: /\b(get\s+it\s+done|done)\s*,\s*partial\s*,\s*or\s*(missed|miss)\b/i,
  },
  {
    reason: "internal_label_finished_started_or_partial",
    re: /\bfinished\s*,\s*started\s*,\s*or\s*partial\b/i,
  },
  { reason: "internal_label_partial_word", re: /\bpartial\b/i },
];

/** Human outcome-check phrasing — allowed even when they mention getting partway done. */
const ALLOWED_HUMAN_PARTIAL_PHRASES: RegExp[] = [
  /\bgot\s+some\s+of\s+it\s+done\b/i,
  /\bstarted\s+it\b/i,
  /\bgot\s+part\s+of\s+it\s+done\b/i,
  /\bsomething\s+got\s+in\s+the\s+way\b/i,
  /\bdid\s+something\s+get\s+in\s+the\s+way\b/i,
  /\bdid\s+you\s+get\s+it\s+done\s*,\s*start\s+it\s*,\s*or\b/i,
  /\bdid\s+you\s+finish\s+it\s*,\s*start\s+it\s*,\s*or\b/i,
  /\bwhat\s+happened\s+with\b/i,
  /\bi\s+got\s+part\s+of\s+it\s+done\b/i,
  /\bi\s+got\s+some\s+of\s+it\s+done\b/i,
  /\bi\s+started\s+it\b/i,
];

function isAllowedHumanOutcomeLanguage(body: string, matchIndex: number, matched: string): boolean {
  if (matched.toLowerCase() !== "partial") return false;
  for (const allow of ALLOWED_HUMAN_PARTIAL_PHRASES) {
    if (allow.test(body)) return true;
  }
  // "partially" in natural speech is ok; standalone menu token "partial" is not.
  const windowStart = Math.max(0, matchIndex - 24);
  const windowEnd = Math.min(body.length, matchIndex + matched.length + 24);
  const window = body.slice(windowStart, windowEnd).toLowerCase();
  if (/\bpartially\b/.test(window)) return true;
  return false;
}

export function detectUserVisibleInternalLabelViolations(body: string): UserVisibleInternalLabelViolation[] {
  const t = body.trim();
  if (!t) return [];
  const hits: UserVisibleInternalLabelViolation[] = [];
  const seen = new Set<string>();

  for (const { reason, re } of INTERNAL_LABEL_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    if (reason === "internal_label_partial_word" && isAllowedHumanOutcomeLanguage(t, m.index, m[0])) {
      continue;
    }
    if (seen.has(reason)) continue;
    seen.add(reason);
    hits.push({ reason, matched: m[0] });
  }

  return hits;
}

export function userVisibleInternalLabelBlockedReasons(body: string): string[] {
  return detectUserVisibleInternalLabelViolations(body).map((v) => v.reason);
}

const INTERNAL_LABEL_BLOCKED_REASON_PREFIX = "internal_label_";

export function hasInternalLabelBlockedReasons(blockedReasons: readonly string[]): boolean {
  return blockedReasons.some((r) => r.startsWith(INTERNAL_LABEL_BLOCKED_REASON_PREFIX));
}

/** Merge internal-label repair guidance into lane / final-voice repair instructions when applicable. */
export function mergeInternalLabelRepairInstruction(
  existingInstruction: string | undefined,
  blockedReasons: readonly string[],
  body: string
): string | undefined {
  if (!hasInternalLabelBlockedReasons(blockedReasons)) return existingInstruction;
  const violations = detectUserVisibleInternalLabelViolations(body);
  const instruction = buildUserVisibleInternalLabelRepairInstruction(
    violations.length > 0
      ? violations
      : blockedReasons
          .filter((r) => r.startsWith(INTERNAL_LABEL_BLOCKED_REASON_PREFIX))
          .map((reason) => ({ reason, matched: reason }))
  );
  return existingInstruction?.trim()
    ? `${existingInstruction.trim()}\n\n${instruction}`
    : instruction;
}

export function buildUserVisibleInternalLabelRepairInstruction(
  violations: UserVisibleInternalLabelViolation[]
): string {
  const reasons = violations.map((v) => v.reason).join(", ");
  return [
    "INTERNAL LABEL LEAK REPAIR:",
    `Blocked: ${reasons}.`,
    "Never use internal enum/menu tokens (partial, user_yes, user_no, yes/no/partial, done/partial/missed, protected/partial/missed, classification, route).",
    "Use human language instead, e.g.:",
    '- "Did it happen, or did something get in the way?"',
    '- "Did you get it done, start it, or miss it?"',
    '- "What happened with the plan before your appointment?"',
    '- "Did you follow through before the appointment, or did something get in the way?"',
    "Do not hard-code a template — one natural SMS question.",
  ].join("\n");
}

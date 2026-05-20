/**
 * Relationship / coaching SMS must not expose robotic YES/NO menu consent copy.
 * Binding verbatim may still contain server-owned instructional phrases once.
 */

function normalizeForMatch(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Instruction-style all-caps YES/NO (robot menu). Lowercase yes/no in natural coaching is allowed.
 * Patterns are case-sensitive on YES/NO tokens; verb prefixes remain case-insensitive.
 */
const REPLY_YES_NO_MENU_CHECKS: Array<[string, RegExp]> = [
  ["reply_yes_no_menu_language", /(?i:\breply)\s+YES\b/],
  ["reply_yes_no_menu_language", /(?i:\breply)\s+NO\b/],
  ["reply_yes_no_menu_language", /(?i:\btext)\s+YES\b/],
  ["reply_yes_no_menu_language", /(?i:\btext)\s+NO\b/],
  ["reply_yes_no_menu_language", /(?i:\bsay)\s+YES\b/],
  ["reply_yes_no_menu_language", /(?i:\bsay)\s+NO\b/],
  ["reply_yes_no_menu_language", /(?i:\brespond)\s+YES\b/],
  ["reply_yes_no_menu_language", /(?i:\brespond)\s+NO\b/],
  ["reply_yes_no_menu_language", /(?i:\bsend)\s+YES\b/],
  ["reply_yes_no_menu_language", /(?i:\bsend)\s+NO\b/],
  ["reply_yes_no_menu_language", /\bYES\s+to\s+confirm\b/],
  ["reply_yes_no_menu_language", /\bNO\s+to\s+discard\b/],
  ["reply_yes_no_menu_language", /(?i:\breply)\s+YES\s+to\b/],
  ["reply_yes_no_menu_language", /(?i:\breply)\s+NO\s+to\b/],
  /** Naked all-caps menu options (not natural lowercase "yes or no"). */
  ["reply_yes_no_menu_language", /\bYES\s+or\s+NO\b/],
  ["reply_yes_no_menu_language", /\bNO\s+or\s+YES\b/],
];

const BINDING_ROBOT_COPY_CHECKS: Array<[string, RegExp]> = [
  ["same_commitment_keep_this_line_robot_copy", /same commitment[—-]keep this line/i],
  ["same_commitment_keep_this_line_robot_copy", /same focus[—-]keep this line/i],
  ["same_commitment_keep_this_line_robot_copy", /\bkeep this line for 7 days\b/i],
];

export const RELATIONSHIP_ROBOT_CONSENT_MENU_REPAIRABLE_REASONS = new Set<string>([
  "reply_yes_no_menu_language",
  "same_commitment_keep_this_line_robot_copy",
  "robotic_contract_menu_language",
]);

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function wrapperOutsideBinding(body: string, binding: string): string {
  const b = binding.trim();
  if (!b) return body;
  const firstIdx = body.indexOf(b);
  if (firstIdx < 0) return body;
  return `${body.slice(0, firstIdx)}${body.slice(firstIdx + b.length)}`;
}

function detectBindingRobotCopyReasons(
  body: string,
  bindingVerbatim: string | null | undefined
): string[] {
  const hits = new Set<string>();
  const norm = normalizeForMatch(body);
  const binding = bindingVerbatim?.trim() ?? "";

  if (!binding) {
    for (const [reason, re] of BINDING_ROBOT_COPY_CHECKS) {
      if (re.test(norm)) hits.add(reason);
    }
    return [...hits];
  }

  if (countSubstringOccurrences(norm, binding) > 1) {
    hits.add("same_commitment_keep_this_line_robot_copy");
  }

  const outside = wrapperOutsideBinding(norm, binding);
  for (const [reason, re] of BINDING_ROBOT_COPY_CHECKS) {
    if (re.test(outside)) hits.add(reason);
  }
  return [...hits];
}

export type DetectRelationshipRobotConsentMenuOptions = {
  /** When set, binding robot phrases are allowed only inside this substring once. */
  bindingVerbatim?: string | null;
};

/**
 * Detect visible robotic contract/consent menu language on relationship SMS.
 */
function detectReplyMenuReasons(body: string, bindingVerbatim: string | null | undefined): string[] {
  const binding = bindingVerbatim?.trim() ?? "";
  const outside = binding ? wrapperOutsideBinding(body, binding) : body;
  const hits = new Set<string>();
  for (const [reason, re] of REPLY_YES_NO_MENU_CHECKS) {
    if (re.test(outside)) hits.add(reason);
  }
  return [...hits];
}

export function detectRelationshipRobotConsentMenuReasons(
  body: string,
  options?: DetectRelationshipRobotConsentMenuOptions
): string[] {
  const norm = normalizeForMatch(body);
  if (!norm) return [];

  const hits = new Set<string>();
  for (const r of detectReplyMenuReasons(norm, options?.bindingVerbatim)) {
    hits.add(r);
  }
  for (const r of detectBindingRobotCopyReasons(norm, options?.bindingVerbatim)) {
    hits.add(r);
  }

  if (hits.size > 0) {
    hits.add("robotic_contract_menu_language");
  }
  return [...hits];
}

export function relationshipRobotConsentMenuNoSendReason(reasons: string[]): string {
  if (reasons.includes("reply_yes_no_menu_language")) return "robotic_contract_menu_language";
  if (reasons.includes("same_commitment_keep_this_line_robot_copy")) {
    return "robotic_contract_menu_language";
  }
  return "robotic_contract_menu_language";
}

export function isRelationshipRobotConsentMenuRepairableReason(reason: string): boolean {
  return RELATIONSHIP_ROBOT_CONSENT_MENU_REPAIRABLE_REASONS.has(reason);
}

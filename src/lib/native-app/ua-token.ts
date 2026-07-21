/**
 * Canonical native iOS app User-Agent token.
 * Appended by the Summitt Mindset iOS WKWebView (mobile LiveShellConfiguration).
 * Exact token only — do not fuzzy-match product names.
 */
export const SUMMITT_MINDSET_IOS_UA_TOKEN = "SummittMindsetiOS" as const;

/**
 * True when the User-Agent string contains the exact native iOS token.
 * Case-sensitive exact substring match of SUMMITT_MINDSET_IOS_UA_TOKEN.
 * Does not inspect client-supplied identity fields or non-UA request signals.
 */
export function isNativeSummittMindsetIosUserAgent(
  userAgent: string | null | undefined
): boolean {
  if (typeof userAgent !== "string" || userAgent.length === 0) {
    return false;
  }
  return userAgent.includes(SUMMITT_MINDSET_IOS_UA_TOKEN);
}

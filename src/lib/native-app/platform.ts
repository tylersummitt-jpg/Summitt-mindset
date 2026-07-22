/**
 * Canonical Summitt Mindset native-app platform detection (website).
 *
 * Markers are exact User-Agent substrings appended by the native WKWebView /
 * WebView shell. Detection is deterministic, side-effect free, and uses only
 * the User-Agent string — never query params, cookies, or user identity.
 */

export type SummittMindsetPlatform = "none" | "ios" | "android";

/** Exact token appended by the Summitt Mindset iOS WKWebView. */
export const SUMMITT_MINDSET_IOS_UA_TOKEN = "SummittMindsetiOS" as const;

/** Exact token reserved for the future Summitt Mindset Android WebView. */
export const SUMMITT_MINDSET_ANDROID_UA_TOKEN = "SummittMindsetAndroid" as const;

/**
 * Detect native platform from a User-Agent string.
 * iOS is checked before Android if both markers somehow appear (deterministic).
 */
export function detectSummittMindsetPlatform(
  userAgent: string | null | undefined
): SummittMindsetPlatform {
  if (typeof userAgent !== "string" || userAgent.length === 0) {
    return "none";
  }
  if (userAgent.includes(SUMMITT_MINDSET_IOS_UA_TOKEN)) {
    return "ios";
  }
  if (userAgent.includes(SUMMITT_MINDSET_ANDROID_UA_TOKEN)) {
    return "android";
  }
  return "none";
}

/** True when the UA identifies either native Summitt Mindset app shell. */
export function isNativeSummittMindsetApp(
  userAgent: string | null | undefined
): boolean {
  return detectSummittMindsetPlatform(userAgent) !== "none";
}

/**
 * Backward-compatible re-exports and iOS-only UA helper.
 * Canonical detection lives in `./platform` — do not duplicate token literals.
 */

export {
  SUMMITT_MINDSET_IOS_UA_TOKEN,
  SUMMITT_MINDSET_ANDROID_UA_TOKEN,
  detectSummittMindsetPlatform,
  isNativeSummittMindsetApp,
  type SummittMindsetPlatform,
} from "@/lib/native-app/platform";

import { detectSummittMindsetPlatform } from "@/lib/native-app/platform";

/**
 * True when the User-Agent contains the exact native iOS token.
 * Prefer `isNativeSummittMindsetApp` / `detectSummittMindsetPlatform` for
 * product gates that apply to all native shells.
 */
export function isNativeSummittMindsetIosUserAgent(
  userAgent: string | null | undefined
): boolean {
  return detectSummittMindsetPlatform(userAgent) === "ios";
}

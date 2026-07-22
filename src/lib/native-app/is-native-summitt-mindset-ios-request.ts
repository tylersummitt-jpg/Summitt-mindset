import {
  detectSummittMindsetPlatformRequest,
  detectSummittMindsetPlatformFromRequest,
} from "@/lib/native-app/is-native-summitt-mindset-app-request";

/**
 * Temporary iOS-only request helpers.
 * Prefer `isNativeSummittMindsetAppRequest` for product gates that apply to
 * all native shells. These wrappers delegate to the canonical detector.
 */

export async function isNativeSummittMindsetIosRequest(): Promise<boolean> {
  return (await detectSummittMindsetPlatformRequest()) === "ios";
}

export function isNativeSummittMindsetIosRequestFromRequest(
  req: Request
): boolean {
  return detectSummittMindsetPlatformFromRequest(req) === "ios";
}

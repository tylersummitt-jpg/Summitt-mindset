import { headers } from "next/headers";
import {
  detectSummittMindsetPlatform,
  isNativeSummittMindsetApp,
  type SummittMindsetPlatform,
} from "@/lib/native-app/platform";

/**
 * Server Components / route handlers: detect native platform from request UA.
 */
export async function detectSummittMindsetPlatformRequest(): Promise<SummittMindsetPlatform> {
  const headerStore = await headers();
  return detectSummittMindsetPlatform(headerStore.get("user-agent"));
}

/**
 * Server Components / route handlers: true for either native app shell.
 */
export async function isNativeSummittMindsetAppRequest(): Promise<boolean> {
  const headerStore = await headers();
  return isNativeSummittMindsetApp(headerStore.get("user-agent"));
}

/**
 * Route handlers that already have a Request: detect native app from that UA.
 */
export function isNativeSummittMindsetAppRequestFromRequest(
  req: Request
): boolean {
  return isNativeSummittMindsetApp(req.headers.get("user-agent"));
}

export function detectSummittMindsetPlatformFromRequest(
  req: Request
): SummittMindsetPlatform {
  return detectSummittMindsetPlatform(req.headers.get("user-agent"));
}

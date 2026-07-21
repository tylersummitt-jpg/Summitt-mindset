import { headers } from "next/headers";
import { isNativeSummittMindsetIosUserAgent } from "@/lib/native-app/ua-token";

/**
 * Server Components / route handlers: detect native iOS app from request UA.
 */
export async function isNativeSummittMindsetIosRequest(): Promise<boolean> {
  const headerStore = await headers();
  return isNativeSummittMindsetIosUserAgent(headerStore.get("user-agent"));
}

/**
 * Route handlers that already have a Request: detect from that request's UA.
 */
export function isNativeSummittMindsetIosRequestFromRequest(
  req: Request
): boolean {
  return isNativeSummittMindsetIosUserAgent(req.headers.get("user-agent"));
}

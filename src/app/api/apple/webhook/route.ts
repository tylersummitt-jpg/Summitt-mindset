import "server-only";

import { NextResponse } from "next/server";
import { handleAppleServerNotification } from "@/lib/apple-iap/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * POST /api/apple/webhook
 *
 * Public App Store Server Notifications V2 endpoint.
 * Authentication is Apple's verified signedPayload. No Clerk session.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const signedPayload =
    body &&
    typeof body === "object" &&
    "signedPayload" in body &&
    typeof (body as { signedPayload?: unknown }).signedPayload === "string"
      ? (body as { signedPayload: string }).signedPayload.trim()
      : "";
  if (!signedPayload) {
    return json({ error: "missing_signed_payload" }, 400);
  }

  const result = await handleAppleServerNotification(signedPayload);
  if (!result.ok) {
    return json(
      {
        error:
          result.http === 500 ? "Internal Server Error" : result.error,
      },
      result.http
    );
  }
  return json({ ok: true }, 200);
}

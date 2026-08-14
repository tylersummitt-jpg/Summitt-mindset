import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import { getOrCreateLiveAppleAccountToken } from "@/lib/apple-iap/bindings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(
  body: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * GET /api/apple/account-token
 *
 * Returns a server-owned stable UUID for StoreKit appAccountToken.
 * Identity is auth().userId only. Clients cannot supply the UUID.
 * Query string and body are not read.
 */
export async function GET(request: Request) {
  void request;
  const { userId } = await auth();
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const deletionGate =
    await assertEntitlementMutationAllowedForAccountDeletion(userId);
  if (!deletionGate.ok) {
    if (deletionGate.code === "lookup_failed") {
      console.error(
        "[apple/account-token] account deletion lookup failed; fail closed"
      );
      return json({ error: "Internal Server Error" }, 500);
    }
    return json({ ...ACCOUNT_DELETION_IN_PROGRESS_BODY }, 409);
  }

  const result = await getOrCreateLiveAppleAccountToken(userId);
  if (!result.ok) {
    console.error("[apple/account-token] binding persistence failed");
    return json({ error: "Internal Server Error" }, 500);
  }

  return json({ appAccountToken: result.appAccountToken }, 200);
}

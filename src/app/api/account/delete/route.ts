/**
 * APP-041F2 — unreachable authenticated account-deletion initiation route.
 *
 * Deployed does not mean activated:
 * - ACCOUNT_DELETION_INITIATION_ENABLED must be exactly "true"
 * - ACCOUNT_DELETION_SCHEDULER_ENABLED must be exactly "true"
 * - Both flags remain off in production for F2/F3
 * - Danger Zone UI (F3) is separately gated by initiation flag only
 *
 * When disabled or unauthorized: no repository call, no providers, no stages.
 * When enabled (future): durable request only — no inline deletion stages.
 *
 * Reauth: when Clerk reports missing strict reverification, return Clerk's
 * reverification hint JSON so client useReverification can challenge + retry.
 * Missing/unavailable has() stays sanitized fail-closed (no mutation).
 */

import { auth, reverificationError } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { initiateAccountDeletionRequestForUser } from "@/lib/account-deletion/initiate-account-deletion-request";
import {
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  isAccountDeletionInitiationFullyEnabled,
  runAccountDeletionInitiation,
} from "@/lib/account-deletion/run-account-deletion-initiation";
import { ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV } from "@/lib/account-deletion/run-account-deletion-scheduler";
import { verifyAccountDeletionReauthenticationWithClerk } from "@/lib/account-deletion/verify-account-deletion-reauthentication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(
  body: { ok: boolean; code: string },
  status: number
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/** Clerk useReverification-compatible 403 (no-store). */
function clerkReverificationResponse(): NextResponse {
  return new NextResponse(JSON.stringify(reverificationError("strict")), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      ...NO_STORE_HEADERS,
    },
  });
}

export async function POST(req: Request) {
  // 1. Authenticate — never mutate before session identity is known.
  const authState = await auth();
  const userId = authState.userId;
  if (!userId) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }

  // 2. Dual exact-string flags — disabled short-circuit before body/reauth/repo.
  const initiationRaw = process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
  const schedulerRaw = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
  if (!isAccountDeletionInitiationFullyEnabled(initiationRaw, schedulerRaw)) {
    return jsonResponse(
      { ok: false, code: ACCOUNT_DELETION_INITIATION_DISABLED_CODE },
      503
    );
  }

  // 3. Parse body (malformed JSON → invalid_confirmation).
  let confirmationBody: unknown;
  try {
    confirmationBody = await req.json();
  } catch {
    return jsonResponse({ ok: false, code: "invalid_confirmation" }, 400);
  }

  // 4–7. Core: confirmation → reauth → create/return → sanitize.
  const hasFn =
    typeof authState.has === "function"
      ? (params: { reverification: "strict" }) =>
          Boolean(authState.has({ reverification: params.reverification }))
      : undefined;
  const result = await runAccountDeletionInitiation({
    authenticatedUserId: userId,
    confirmationBody,
    initiationEnabledRaw: initiationRaw,
    schedulerEnabledRaw: schedulerRaw,
    verifyReauthentication: async () =>
      verifyAccountDeletionReauthenticationWithClerk(hasFn),
    createOrGetRequest: (clerkUserId) =>
      initiateAccountDeletionRequestForUser(clerkUserId),
  });

  // F3 client useReverification requires Clerk hint shape (not sanitized code).
  if (result.body.code === "reauth_required") {
    return clerkReverificationResponse();
  }
  // Unavailable has()/throw — sanitized; no mutation occurred.
  if (result.body.code === "reauth_unavailable") {
    return jsonResponse({ ok: false, code: "reauth_required" }, 403);
  }

  return jsonResponse(result.body, result.httpStatus);
}

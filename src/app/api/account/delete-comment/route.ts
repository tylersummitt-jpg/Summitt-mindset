/**
 * Best-effort opted-in deletion note.
 * Does not create, settle, or modify an account-deletion request.
 * A missing database function still returns success after the body is valid.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { recordAccountDeletionComment } from "@/lib/account-deletion/account-deletion-comment.server";
import { validateAccountDeletionCommentBody } from "@/lib/account-deletion/account-deletion-comment-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(body: { ok: boolean }, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  const authState = await auth();
  const userId = authState.userId;
  if (!userId) {
    return jsonResponse({ ok: false }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false }, 400);
  }

  const parsed = validateAccountDeletionCommentBody(body);
  if (!parsed.ok) {
    return jsonResponse({ ok: false }, 400);
  }

  await recordAccountDeletionComment(userId, parsed.message);
  return jsonResponse({ ok: true }, 200);
}

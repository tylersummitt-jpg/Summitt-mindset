import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { removeVictoryWinMediaForUser } from "@/lib/victory-media/remove-victory-win-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC = "We couldn’t remove this photo. Please try again.";
const UI_DELETION = "This action is unavailable.";
const UI_NOT_FOUND = "Win not found.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteParams = { params: Promise<{ winId: string }> | { winId: string } };

async function resolveWinId(params: RouteParams["params"]): Promise<string> {
  const p = params instanceof Promise ? await params : params;
  return typeof p?.winId === "string" ? p.winId.trim() : "";
}

/**
 * DELETE /api/victory-media/win/[winId]
 * Authenticated: removes optional photo for an owned Win.
 * Never accepts Storage paths or mediaId from the client.
 */
export async function DELETE(_req: Request, ctx: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: UI_SESSION, code: "unauthorized" },
        { status: 401 }
      );
    }

    let deleting: boolean;
    try {
      deleting = await hasUnresolvedAccountDeletionRequest(userId);
    } catch {
      return NextResponse.json(
        { ok: false, error: UI_GENERIC, code: "deletion_lookup_failed" },
        { status: 503 }
      );
    }
    if (deleting) {
      return NextResponse.json(
        {
          ok: false,
          error: UI_DELETION,
          code: "account_deletion_in_progress",
        },
        { status: 409 }
      );
    }

    const winId = await resolveWinId(ctx.params);
    if (!winId || !UUID_RE.test(winId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid request.", code: "invalid_input" },
        { status: 400 }
      );
    }

    const result = await removeVictoryWinMediaForUser({
      clerkUserId: userId,
      winId,
    });

    if (!result.ok) {
      if (result.code === "not_found") {
        return NextResponse.json(
          { ok: false, error: UI_NOT_FOUND, code: "not_found" },
          { status: 404 }
        );
      }
      if (result.code === "invalid_input") {
        return NextResponse.json(
          { ok: false, error: "Invalid request.", code: "invalid_input" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { ok: false, error: UI_GENERIC, code: "remove_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
    });
  } catch (e) {
    console.warn(
      "[api/victory-media/win DELETE]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json(
      { ok: false, error: UI_GENERIC, code: "remove_failed" },
      { status: 500 }
    );
  }
}

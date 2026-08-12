import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { replaceVictoryWinMediaForUser } from "@/lib/victory-media/replace-victory-win-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC =
  "We couldn’t replace the photo. Your current photo is still there.";
const UI_MISSING = "We couldn’t find that upload. Please try again.";
const UI_NOT_FOUND = "Win not found.";
const UI_DELETION = "This action is unavailable.";
const UI_STALE =
  "This photo changed since you opened it. Refresh and try again.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteParams = { params: Promise<{ winId: string }> | { winId: string } };

async function resolveWinId(params: RouteParams["params"]): Promise<string> {
  const p = params instanceof Promise ? await params : params;
  return typeof p?.winId === "string" ? p.winId.trim() : "";
}

function statusForCode(code: string): number {
  switch (code) {
    case "invalid_input":
    case "unsupported_format":
    case "dangerous_svg":
    case "animated_gif_not_supported":
    case "corrupt_image":
    case "heic_requires_storage_source":
    case "too_large":
    case "too_large_bytes":
    case "too_many_pixels":
    case "invalid_normalized_media":
      return 400;
    case "object_missing":
    case "not_found":
      return 404;
    case "stale_media":
    case "no_media":
      return 409;
    default:
      return 500;
  }
}

function errorForCode(code: string): string {
  switch (code) {
    case "object_missing":
      return UI_MISSING;
    case "not_found":
      return UI_NOT_FOUND;
    case "stale_media":
    case "no_media":
      return UI_STALE;
    case "invalid_input":
      return "Invalid request.";
    case "unsupported_format":
    case "dangerous_svg":
    case "animated_gif_not_supported":
      return "That image type isn’t supported.";
    case "too_large":
    case "too_large_bytes":
    case "too_many_pixels":
      return "That image is too large.";
    default:
      return UI_GENERIC;
  }
}

/**
 * POST /api/victory-media/win/[winId]/replace
 * Authenticated Replace Photo. Body: uploadId, expectedMediaId, declaredMime, originalFilename.
 * Never accepts durable paths / source_type / provenance from the client.
 */
export async function POST(req: Request, ctx: RouteParams) {
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (
      body.bytes != null ||
      body.file != null ||
      body.path != null ||
      body.tempPath != null ||
      body.storageMasterPath != null ||
      body.storageCardPath != null ||
      body.sourceType != null ||
      body.source_type != null ||
      body.mediaId != null ||
      body.media_id != null ||
      body.newMediaId != null ||
      body.clerkUserId != null ||
      body.clerk_user_id != null ||
      body.bucket != null
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid request.", code: "invalid_input" },
        { status: 400 }
      );
    }

    const result = await replaceVictoryWinMediaForUser({
      clerkUserId: userId,
      winId,
      uploadId:
        typeof body.uploadId === "string"
          ? body.uploadId
          : typeof body.upload_id === "string"
            ? body.upload_id
            : "",
      expectedMediaId:
        typeof body.expectedMediaId === "string"
          ? body.expectedMediaId
          : typeof body.expected_media_id === "string"
            ? body.expected_media_id
            : "",
      declaredMime:
        typeof body.declaredMime === "string"
          ? body.declaredMime
          : typeof body.declared_mime === "string"
            ? body.declared_mime
            : null,
      originalFilename:
        typeof body.originalFilename === "string"
          ? body.originalFilename
          : typeof body.original_filename === "string"
            ? body.original_filename
            : null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: errorForCode(result.code),
          code: result.code === "stale_media" || result.code === "no_media"
            ? "stale_media"
            : result.code,
        },
        { status: statusForCode(result.code) }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      media: result.media
        ? {
            id: result.media.id,
            cardUrl: result.media.cardUrl,
            width: result.media.width,
            height: result.media.height,
          }
        : null,
      ...(result.cardSignFailed ? { cardSignFailed: true } : {}),
    });
  } catch (e) {
    console.warn(
      "[api/victory-media/win replace]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json(
      { ok: false, error: UI_GENERIC, code: "rpc_failed" },
      { status: 500 }
    );
  }
}

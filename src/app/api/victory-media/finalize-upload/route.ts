import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { finalizeWebUpload } from "@/lib/victory-media/finalize-web-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC = "We couldn’t save this photo. Please try again.";
const UI_MISSING = "We couldn’t find that upload. Please try again.";
const UI_EXISTS = "This Win already has a photo.";
const UI_NOT_FOUND = "Win not found.";

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
    case "win_not_found":
      return 404;
    case "win_forbidden":
      return 403;
    case "media_exists":
    case "media_id_conflict":
    case "mms_provenance_conflict":
    case "win_not_attachable":
      return 409;
    default:
      return 500;
  }
}

function errorForCode(code: string): string {
  switch (code) {
    case "object_missing":
      return UI_MISSING;
    case "win_not_found":
    case "win_forbidden":
      return UI_NOT_FOUND;
    case "media_exists":
      return UI_EXISTS;
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
 * POST /api/victory-media/finalize-upload
 * Authenticated: normalize private temp object → durable master/card + v2_win_media.
 * Body is IDs/metadata only — never raw image bytes.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: UI_SESSION, code: "unauthorized" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Never accept raw bytes or caller identity / bucket overrides.
    if (
      body.bytes != null ||
      body.file != null ||
      body.image != null ||
      body.data != null ||
      body.buffer != null ||
      body.clerkUserId != null ||
      body.clerk_user_id != null ||
      body.bucket != null ||
      body.mediaId != null ||
      body.media_id != null
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid request.", code: "invalid_input" },
        { status: 400 }
      );
    }

    const result = await finalizeWebUpload({
      clerkUserId: userId,
      winId:
        typeof body.winId === "string"
          ? body.winId
          : typeof body.win_id === "string"
            ? body.win_id
            : "",
      uploadId:
        typeof body.uploadId === "string"
          ? body.uploadId
          : typeof body.upload_id === "string"
            ? body.upload_id
            : "",
      tempPath:
        typeof body.tempPath === "string"
          ? body.tempPath
          : typeof body.temp_path === "string"
            ? body.temp_path
            : null,
      originalFilename:
        typeof body.originalFilename === "string"
          ? body.originalFilename
          : typeof body.original_filename === "string"
            ? body.original_filename
            : null,
      declaredMime:
        typeof body.declaredMime === "string"
          ? body.declaredMime
          : typeof body.declared_mime === "string"
            ? body.declared_mime
            : null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: errorForCode(result.code),
          code: result.code,
        },
        { status: statusForCode(result.code) }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      media: {
        id: result.media.id,
        winId: result.media.winId,
        sourceType: result.media.sourceType,
        mimeType: result.media.mimeType,
        byteSize: result.media.byteSize,
        width: result.media.width,
        height: result.media.height,
        cardByteSize: result.media.cardByteSize,
        cardWidth: result.media.cardWidth,
        cardHeight: result.media.cardHeight,
        userSelectedAt: result.media.userSelectedAt,
        createdAt: result.media.createdAt,
        updatedAt: result.media.updatedAt,
        // Paths are durable private keys — returned for server/client metadata
        // contracts; not public URLs.
        storageMasterPath: result.media.storageMasterPath,
        storageCardPath: result.media.storageCardPath,
      },
      tempCleanup: result.tempCleanup,
    });
  } catch (e) {
    console.warn(
      "[api/victory-media/finalize-upload]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json(
      { ok: false, error: UI_GENERIC, code: "db_insert_failed" },
      { status: 500 }
    );
  }
}

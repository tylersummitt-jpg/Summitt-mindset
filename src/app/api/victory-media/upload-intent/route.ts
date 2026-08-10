import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { createWebUploadIntent } from "@/lib/victory-media/create-web-upload-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC = "We couldn’t prepare this upload. Please try again.";
const UI_UNSUPPORTED =
  "That image type isn’t supported. Use HEIC, JPEG, PNG, or WebP.";

/**
 * POST /api/victory-media/upload-intent
 * Authenticated: issues a signed private temp upload target.
 * Does not accept caller-chosen Storage paths. Does not proxy file bytes.
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

    // Reject caller-supplied identity / path control fields.
    if (
      body.clerkUserId != null ||
      body.clerk_user_id != null ||
      body.path != null ||
      body.tempPath != null ||
      body.temp_path != null ||
      body.bucket != null
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid request.", code: "invalid_input" },
        { status: 400 }
      );
    }

    const result = await createWebUploadIntent({
      clerkUserId: userId,
      winId:
        typeof body.winId === "string"
          ? body.winId
          : typeof body.win_id === "string"
            ? body.win_id
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
      const status =
        result.code === "unsupported_mime"
          ? 400
          : result.code === "invalid_input"
            ? 400
            : 500;
      const error =
        result.code === "unsupported_mime"
          ? UI_UNSUPPORTED
          : result.code === "invalid_input"
            ? "Invalid request."
            : UI_GENERIC;
      return NextResponse.json(
        { ok: false, error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      uploadId: result.uploadId,
      path: result.path,
      bucket: result.bucket,
      signedUrl: result.signedUrl,
      token: result.token,
      maxBytes: result.maxBytes,
      allowedMimeTypes: result.allowedMimeTypes,
    });
  } catch (e) {
    console.warn(
      "[api/victory-media/upload-intent]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json(
      { ok: false, error: UI_GENERIC, code: "signed_upload_failed" },
      { status: 500 }
    );
  }
}

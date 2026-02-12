import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  recordFeedbackPromptShown,
  recordFeedbackIgnored,
} from "@/lib/feedback-state";

/**
 * ======================================================
 * Feedback State Gateway (CANONICAL)
 * ======================================================
 *
 * Client components are NOT allowed to touch Clerk metadata.
 *
 * This API route is the ONLY way feedback prompts update:
 *
 * feedbackState: {
 *   lastPromptedAt,
 *   ignoredCount,
 *   pausedUntil
 * }
 *
 * Supported actions:
 *
 * - "shown"   → prompt displayed
 * - "ignored" → user dismissed / skipped
 *
 * Summitt must never feel like survey software.
 */

export const runtime = "nodejs";

type Payload = {
  action: "shown" | "ignored";
};

export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: Payload;

  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const action = body.action;

  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Missing action" },
      { status: 400 }
    );
  }

  try {
    // ======================================================
    // ✅ PROMPT SHOWN
    // ======================================================
    if (action === "shown") {
      await recordFeedbackPromptShown(userId);

      return NextResponse.json({
        ok: true,
        recorded: "shown",
      });
    }

    // ======================================================
    // ✅ PROMPT IGNORED
    // ======================================================
    if (action === "ignored") {
      await recordFeedbackIgnored(userId);

      return NextResponse.json({
        ok: true,
        recorded: "ignored",
      });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Feedback state update failed:", err);

    return NextResponse.json(
      { ok: false, error: "Server failed" },
      { status: 500 }
    );
  }
}

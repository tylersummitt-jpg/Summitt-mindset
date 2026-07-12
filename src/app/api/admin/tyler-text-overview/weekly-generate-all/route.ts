import { NextResponse } from "next/server";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  generateMissingWeeklyDraftsForAllSendableUsers,
  WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY,
  type WeeklyTtoGenerateAllMode,
} from "@/lib/tyler-text-overview-weekly-generate-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Batch OpenAI generation for ~40 users; allow longer than default serverless limit. */
export const maxDuration = 300;

function adminErrorResponse(err: unknown) {
  const status =
    err != null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  const message = err instanceof Error ? err.message : "unknown_error";
  return NextResponse.json({ ok: false, error: message }, { status });
}

function parseMode(body: unknown): WeeklyTtoGenerateAllMode | { error: string } {
  if (body == null || typeof body !== "object") {
    return WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;
  }
  if (!("mode" in body) || (body as { mode?: unknown }).mode == null) {
    return WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;
  }
  const mode = (body as { mode: unknown }).mode;
  if (mode === WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY) {
    return WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;
  }
  return { error: `unsupported_mode:${String(mode)}` };
}

export async function POST(req: Request) {
  try {
    await requireTylerAdmin();

    let body: unknown = {};
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
    } else {
      try {
        const text = await req.text();
        if (text.trim()) {
          body = JSON.parse(text);
        }
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
    }

    const modeOrError = parseMode(body);
    if (typeof modeOrError === "object" && "error" in modeOrError) {
      return NextResponse.json({ ok: false, error: modeOrError.error }, { status: 400 });
    }

    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      mode: modeOrError,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/tyler-text-overview/weekly-generate-all] POST failed", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    if (message === "tyler_text_overview_disabled") {
      return NextResponse.json({ ok: false, error: message }, { status: 503 });
    }
    if (message.startsWith("unsupported_mode:")) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}

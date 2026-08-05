import { NextResponse } from "next/server";

import {
  listSendableTylerTextOverviewRows,
  resolveAdminListSendSlot,
  TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX,
} from "@/lib/tyler-text-overview-admin";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "unknown_error";
  const incomplete = message.startsWith(TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX);
  const status =
    incomplete
      ? 503
      : err != null &&
          typeof err === "object" &&
          "status" in err &&
          typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;

  return NextResponse.json(
    {
      ok: false,
      error: message,
      manifestIncomplete: incomplete,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function GET(req: Request) {
  try {
    await requireTylerAdmin();

    const url = new URL(req.url);
    const draftForDayKey = url.searchParams.get("draft_for_day_key");
    const sendSlot = resolveAdminListSendSlot(url.searchParams.get("send_slot"));
    const searchQuery = url.searchParams.get("q") ?? url.searchParams.get("search");

    const { rows, counts, availableDayKeys, manifest } = await listSendableTylerTextOverviewRows({
      draftForDayKey,
      sendSlot,
      searchQuery,
    });

    return NextResponse.json(
      {
        ok: true,
        rows,
        counts,
        availableDayKeys,
        sendSlot,
        manifest,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    console.error("[admin/tyler-text-overview] GET failed", err);
    return adminErrorResponse(err);
  }
}

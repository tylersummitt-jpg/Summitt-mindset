import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  loadOwnedSeasonForManualWin,
  persistManualV2Win,
} from "@/lib/v2-win-manual-persist";

export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC = "We couldn’t save this Win. Please try again.";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: UI_SESSION }, { status: 401 });
    }

    const user = await currentUser();
    const md = (user?.publicMetadata || {}) as Record<string, unknown>;
    const timeZone = resolveUserTimezone(md?.timezone);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Never accept client commitment_id / relationship_type / provenance.
    if (body.commitment_id != null || body.commitmentId != null) {
      return NextResponse.json(
        { ok: false, error: "Invalid request." },
        { status: 400 }
      );
    }

    const seasonIdRaw =
      typeof body.season_id === "string"
        ? body.season_id.trim()
        : typeof body.seasonId === "string"
          ? body.seasonId.trim()
          : "";

    let season: { seasonId: string; commitmentId: string } | null = null;
    if (seasonIdRaw) {
      const owned = await loadOwnedSeasonForManualWin({
        clerkUserId: userId,
        seasonId: seasonIdRaw,
      });
      if (!owned) {
        return NextResponse.json(
          { ok: false, error: "That Season isn’t available.", code: "season_not_found" },
          { status: 404 }
        );
      }
      season = { seasonId: owned.id, commitmentId: owned.commitment_id };
    }

    const result = await persistManualV2Win({
      clerkUserId: userId,
      clientRequestId:
        typeof body.client_request_id === "string"
          ? body.client_request_id
          : typeof body.clientRequestId === "string"
            ? body.clientRequestId
            : "",
      title: typeof body.title === "string" ? body.title : "",
      details:
        typeof body.details === "string"
          ? body.details
          : body.details == null
            ? null
            : "",
      occurredOn:
        typeof body.occurred_on === "string"
          ? body.occurred_on
          : typeof body.occurredOn === "string"
            ? body.occurredOn
            : "",
      timeZone,
      season,
    });

    if (!result.ok) {
      const status =
        result.code === "unauthorized"
          ? 401
          : result.code === "unsafe_content"
            ? 400
            : result.code === "future_date" || result.code === "validation"
              ? 400
              : result.code === "season_not_found"
                ? 404
                : 500;
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      win_id: result.id,
      idempotency_key: result.idempotency_key,
      season_id: season?.seasonId ?? null,
      redirect_to: season
        ? `/dashboard/victory-room/seasons/${season.seasonId}`
        : "/dashboard/victory-room",
    });
  } catch (e) {
    console.warn("[api/v2/wins/manual]", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return NextResponse.json({ ok: false, error: UI_GENERIC }, { status: 500 });
  }
}

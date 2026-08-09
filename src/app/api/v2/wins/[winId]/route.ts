import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { resolveUserTimezone } from "@/lib/timezone";
import { applyUserVictoryWinEdit } from "@/lib/v2-win-user-edit";
import { deleteUserVictoryWin } from "@/lib/v2-win-user-delete";

export const dynamic = "force-dynamic";

const UI_SESSION = "Your session expired. Please sign in again.";
const UI_GENERIC = "We couldn’t save this Win. Please try again.";
const UI_DELETE_GENERIC = "We couldn’t delete this Win. Please try again.";

type RouteParams = { params: Promise<{ winId: string }> | { winId: string } };

async function resolveWinId(params: RouteParams["params"]): Promise<string> {
  const p = params instanceof Promise ? await params : params;
  return typeof p?.winId === "string" ? p.winId.trim() : "";
}

const FORBIDDEN_WIN_MUTATION_KEYS = [
  "commitment_id",
  "commitmentId",
  "clerk_user_id",
  "clerkUserId",
  "source_type",
  "sourceType",
  "source_message_sid",
  "source_message_id",
  "source_event_id",
  "candidate_ordinal",
  "idempotency_key",
  "recognition_mode",
  "schema_version",
  "model_confidence",
  "user_edited_at",
  "userEditedAt",
  "status",
  "hidden_at",
  "hidden_reason",
  "action_fact",
  "why_meaningful",
  "relationship_type",
  "supporting_quote",
] as const;

function rejectForbiddenBodyKeys(body: Record<string, unknown>): NextResponse | null {
  for (const key of FORBIDDEN_WIN_MUTATION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null) {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }
  }
  return null;
}

export async function PATCH(req: Request, ctx: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: UI_SESSION }, { status: 401 });
    }

    const winId = await resolveWinId(ctx.params);
    if (!winId) {
      return NextResponse.json({ ok: false, error: "Win not found.", code: "not_found" }, { status: 404 });
    }

    const user = await currentUser();
    const md = (user?.publicMetadata || {}) as Record<string, unknown>;
    const timeZone = resolveUserTimezone(md?.timezone);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const forbidden = rejectForbiddenBodyKeys(body);
    if (forbidden) return forbidden;

    const seasonId =
      body.season_id === null || body.seasonId === null
        ? null
        : typeof body.season_id === "string"
          ? body.season_id
          : typeof body.seasonId === "string"
            ? body.seasonId
            : body.season_id === undefined && body.seasonId === undefined
              ? null
              : body.season_id ?? body.seasonId;

    const result = await applyUserVictoryWinEdit({
      clerkUserId: userId,
      winId,
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
      seasonId,
      expectedUpdatedAt:
        typeof body.expected_updated_at === "string"
          ? body.expected_updated_at
          : typeof body.expectedUpdatedAt === "string"
            ? body.expectedUpdatedAt
            : "",
      timeZone,
    });

    if (!result.ok) {
      const status =
        result.code === "unauthorized"
          ? 401
          : result.code === "not_found"
            ? 404
            : result.code === "conflict"
              ? 409
              : result.code === "season_not_found"
                ? 404
                : result.code === "unsafe_content" ||
                    result.code === "future_date" ||
                    result.code === "validation"
                  ? 400
                  : 500;
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      win_id: result.win_id,
      updated_at: result.updated_at,
      revision_id: result.revision_id,
      user_edited_at: result.user_edited_at,
    });
  } catch (e) {
    console.warn(
      "[api/v2/wins/PATCH]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json({ ok: false, error: UI_GENERIC }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: UI_SESSION }, { status: 401 });
    }

    const winId = await resolveWinId(ctx.params);
    if (!winId) {
      return NextResponse.json({ ok: false, error: "Win not found.", code: "not_found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const forbidden = rejectForbiddenBodyKeys(body);
    if (forbidden) return forbidden;

    const result = await deleteUserVictoryWin({
      clerkUserId: userId,
      winId,
      expectedUpdatedAt:
        typeof body.expected_updated_at === "string"
          ? body.expected_updated_at
          : typeof body.expectedUpdatedAt === "string"
            ? body.expectedUpdatedAt
            : "",
    });

    if (!result.ok) {
      const status =
        result.code === "unauthorized"
          ? 401
          : result.code === "not_found"
            ? 404
            : result.code === "conflict"
              ? 409
              : 500;
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn(
      "[api/v2/wins/DELETE]",
      e instanceof Error ? e.message.slice(0, 120) : "unknown"
    );
    return NextResponse.json({ ok: false, error: UI_DELETE_GENERIC }, { status: 500 });
  }
}

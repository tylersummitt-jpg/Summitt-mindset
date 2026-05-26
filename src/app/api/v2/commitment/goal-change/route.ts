import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { applyCanonicalGoalChangeWithSeasonMutation } from "@/lib/v2-apply-canonical-goal-change";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  ensureCommitmentReplacePendingForCanonicalGoalChange,
} from "@/lib/v2-guided-resolution";
import { isUnsafeSmsGoalCandidateText } from "@/lib/sms-inbound-safety";
import { UPDATE_GOAL_REQUIRES_NEW_CHAPTER_USER_MESSAGE } from "@/lib/update-goal-season-copy";
import { hasActiveAccountabilitySeasonForCommitment } from "@/lib/v2-accountability-season-alignment";
import { isSmsSeasonMode } from "@/lib/v2-sms-season-mode";

export const dynamic = "force-dynamic";

const BEHAVIOR_MAX = 2000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeBar(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * POST /api/v2/commitment/goal-change
 * Proactive in-app goal update via canonical season-aware RPC (after pending bootstrap).
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const raw =
      typeof body.behavior_statement === "string" ? body.behavior_statement.trim() : "";
    const seasonModeRaw = body.season_mode;
    const clientRequestId =
      typeof body.client_request_id === "string" ? body.client_request_id.trim() : "";

    if (!raw) {
      return NextResponse.json({ ok: false, error: "behavior_statement required" }, { status: 400 });
    }
    if (raw.length > BEHAVIOR_MAX) {
      return NextResponse.json(
        { ok: false, error: `behavior_statement too long (max ${BEHAVIOR_MAX})` },
        { status: 400 }
      );
    }
    if (!isSmsSeasonMode(seasonModeRaw)) {
      return NextResponse.json(
        { ok: false, error: "season_mode must be same_season_sync or new_chapter" },
        { status: 400 }
      );
    }
    if (!UUID_RE.test(clientRequestId)) {
      return NextResponse.json(
        { ok: false, error: "client_request_id must be a valid UUID" },
        { status: 400 }
      );
    }
    if (isUnsafeSmsGoalCandidateText(raw)) {
      return NextResponse.json({ ok: false, error: "unsafe_goal_content" }, { status: 400 });
    }

    let commitment = await getActiveCommitment(userId);
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    const currentNorm = normalizeBar(commitment.behavior_statement);
    const newNorm = normalizeBar(raw);
    if (currentNorm === newNorm) {
      return NextResponse.json(
        { ok: false, error: "New goal matches your current bar." },
        { status: 400 }
      );
    }

    if (seasonModeRaw === "same_season_sync") {
      const aligned = await hasActiveAccountabilitySeasonForCommitment(userId, commitment.id);
      if (!aligned) {
        return NextResponse.json(
          {
            ok: false,
            code: "requires_new_chapter_no_active_season",
            error: UPDATE_GOAL_REQUIRES_NEW_CHAPTER_USER_MESSAGE,
          },
          { status: 400 }
        );
      }
    }

    const pendingResult = await ensureCommitmentReplacePendingForCanonicalGoalChange({
      clerkUserId: userId,
      commitment,
      behaviorStatement: raw,
      seasonMode: seasonModeRaw,
      clientRequestId,
      allowExistingAppGoalChangeOnly: true,
    });

    if (!pendingResult.ok) {
      const status =
        pendingResult.code === "low_pressure_reactivation" ||
        pendingResult.code === "sms_pending_in_flight" ||
        pendingResult.code === "pending_tighten" ||
        pendingResult.code === "pending_identity" ||
        pendingResult.code === "pending_other_update" ||
        pendingResult.code === "competing_app_goal_change"
          ? 409
          : pendingResult.code === "no_active_commitment"
            ? 404
            : 409;
      return NextResponse.json(
        { ok: false, error: pendingResult.message, code: pendingResult.code },
        { status }
      );
    }

    commitment = pendingResult.commitment;

    const idempotencyKey = `app_goal_change:${clientRequestId}`;
    const applied = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: userId,
      commitment,
      behaviorStatement: raw,
      seasonMode: seasonModeRaw,
      idempotencyKey,
      proofMessageSid: idempotencyKey,
      memoryReasonCode: "app_goal_change",
      memoryReasonCodeIdempotentReplay: "app_goal_change_raced_winner",
    });

    if (!applied.ok) {
      if (applied.code === "stale_commitment") {
        return NextResponse.json(
          { ok: false, error: "Your commitment changed elsewhere. Refresh and try again." },
          { status: 409 }
        );
      }
      if (applied.code === "no_active_season_for_commitment") {
        return NextResponse.json(
          {
            ok: false,
            error: "Your accountability setup needs a quick reset before this can be changed.",
            code: applied.code,
          },
          { status: 409 }
        );
      }
      if (applied.code === "unsafe_goal_content") {
        return NextResponse.json({ ok: false, error: "unsafe_goal_content" }, { status: 400 });
      }
      if (applied.code === "invalid_pending_kind") {
        console.error("[goal-change] invalid_pending_kind after bootstrap", { userId });
        return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
      }
      return NextResponse.json(
        { ok: false, error: "Could not update goal", code: applied.code },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      seasonMode: applied.seasonMode,
      sameChapter: applied.seasonMode === "same_season_sync",
      oldCommitmentId: applied.oldCommitmentId,
      newCommitmentId: applied.newCommitmentId,
      idempotentReplay: applied.idempotentReplay,
    });
  } catch (e) {
    console.error("[goal-change]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

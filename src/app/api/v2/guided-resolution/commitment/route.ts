import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { applyCanonicalGoalChangeWithSeasonMutation } from "@/lib/v2-apply-canonical-goal-change";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  type V2AppGoalChangePendingPayload,
  type V2GuidedResolutionPayload,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import {
  resolveSeasonModeForGuidedCommitmentReplace,
  type SeasonModePendingContext,
} from "@/lib/v2-sms-season-mode";
import { isUnsafeSmsGoalCandidateText } from "@/lib/sms-inbound-safety";

export const dynamic = "force-dynamic";

const BEHAVIOR_MAX = 2000;

function pendingSeasonContext(
  pending: ReturnType<typeof getPendingResolutionOrNull>
): {
  pendingPayload: SeasonModePendingContext | null;
  refreshResolution: V2GuidedResolutionPayload["resolution"] | null;
} {
  const payload = pending?.payload ?? null;
  if (!payload) return { pendingPayload: null, refreshResolution: null };
  if (payload.source === "coaching_refresh_resolved") {
    return { pendingPayload: null, refreshResolution: payload.resolution };
  }
  if (payload.source === "sms_inbound" || payload.source === "app_goal_change") {
    return {
      pendingPayload: payload as SeasonModePendingContext & V2SmsPendingResolutionPayload,
      refreshResolution: null,
    };
  }
  return { pendingPayload: null, refreshResolution: null };
}

function guidedIdempotencyKey(
  commitmentId: string,
  pending: ReturnType<typeof getPendingResolutionOrNull>,
  behavior: string
): string {
  const payload = pending?.payload;
  if (payload && "inbound_message_sid" in payload && typeof payload.inbound_message_sid === "string") {
    const sid = payload.inbound_message_sid.trim();
    if (sid) return `guided_resolution:${commitmentId}:${sid}`;
  }
  if (
    payload &&
    payload.source === "app_goal_change" &&
    typeof (payload as V2AppGoalChangePendingPayload).client_request_id === "string"
  ) {
    const cid = (payload as V2AppGoalChangePendingPayload).client_request_id.trim();
    if (cid) return `guided_resolution:${commitmentId}:${cid}`;
  }
  return `guided_resolution:${commitmentId}:${behavior.trim().slice(0, 80)}`;
}

/**
 * POST /api/v2/guided-resolution/commitment
 * Completes pending commitment_replace via canonical season-aware RPC (not guided_replace alone).
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
    if (!raw) {
      return NextResponse.json({ ok: false, error: "behavior_statement required" }, {
        status: 400,
      });
    }
    if (raw.length > BEHAVIOR_MAX) {
      return NextResponse.json(
        { ok: false, error: `behavior_statement too long (max ${BEHAVIOR_MAX})` },
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

    await clearPendingResolutionIfExpired(commitment.id, commitment);
    commitment = (await getActiveCommitment(userId)) ?? commitment;
    if (!commitment?.id) {
      return NextResponse.json({ ok: false, error: "No active commitment" }, { status: 404 });
    }

    const pending = getPendingResolutionOrNull(commitment);
    if (!pending || pending.kind !== "commitment_replace") {
      return NextResponse.json(
        { ok: false, error: "No pending commitment update" },
        { status: 409 }
      );
    }

    if (commitment.accountability_phase === "low_pressure_reactivation") {
      await clearPendingResolution(commitment.id);
      return NextResponse.json(
        { ok: false, error: "Guided resolution is not available during low-pressure pause." },
        { status: 409 }
      );
    }

    const { pendingPayload, refreshResolution } = pendingSeasonContext(pending);
    const seasonResolved = resolveSeasonModeForGuidedCommitmentReplace({
      behaviorStatement: raw,
      currentBehaviorStatement: commitment.behavior_statement,
      pendingPayload,
      refreshResolution,
    });

    const idempotencyKey = guidedIdempotencyKey(commitment.id, pending, raw);
    const applied = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: userId,
      commitment,
      behaviorStatement: raw,
      seasonMode: seasonResolved.mode,
      idempotencyKey,
      proofMessageSid: idempotencyKey,
      memoryReasonCode: "guided_resolution_replace",
      memoryReasonCodeIdempotentReplay: "guided_resolution_replace_raced_winner",
    });

    if (!applied.ok) {
      if (applied.code === "stale_commitment") {
        return NextResponse.json(
          { ok: false, error: "Replacement changed by another request. Refresh and try again." },
          { status: 409 }
        );
      }
      if (applied.code === "invalid_pending_kind") {
        return NextResponse.json(
          { ok: false, error: "No pending commitment update" },
          { status: 409 }
        );
      }
      console.error("[guided-resolution/commitment] canonical apply failed", applied.code);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      replacedCommitmentId: applied.oldCommitmentId,
      newCommitmentId: applied.newCommitmentId,
      seasonMode: applied.seasonMode,
    });
  } catch (e) {
    console.error("[guided-resolution/commitment]", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

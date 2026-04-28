import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isSummittSubscribedFromClerkMetadata,
  isUserFullyOnV2AccountabilityPath,
} from "@/lib/v2-cutover-gates";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
  validateSuccessCriteriaIntake,
} from "@/lib/v2-commitment-intake-validation";

export const dynamic = "force-dynamic";

function parseBody(body: Record<string, unknown>): {
  title: string;
  behavior: string;
  success: string | null;
} | { error: string } {
  const titleRaw =
    typeof body?.commitment_title === "string"
      ? body.commitment_title.trim()
      : typeof body?.title === "string"
        ? body.title.trim()
        : "";
  const behaviorRaw =
    typeof body?.behavior_statement === "string" ? body.behavior_statement.trim() : "";
  const successRaw = body?.success_criteria;
  const success =
    typeof successRaw === "string" && successRaw.trim().length > 0
      ? normalizeIntakeWhitespace(successRaw)
      : null;

  const titleErr = validateCommitmentTitleIntake(titleRaw);
  if (titleErr) return { error: titleErr };

  const behaviorErr = validateBehaviorStatementIntake(behaviorRaw);
  if (behaviorErr) return { error: behaviorErr };

  const successErr = validateSuccessCriteriaIntake(success);
  if (successErr) return { error: successErr };

  return {
    title: normalizeIntakeWhitespace(titleRaw),
    behavior: normalizeIntakeWhitespace(behaviorRaw),
    success,
  };
}

/**
 * POST /api/v2/cutover/commitment
 * Legacy cutover: onboarded + subscribed users who are not fully on V2 can set/repair commitment.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const md = (await getClerkPublicMetadata(userId)) as Record<string, unknown> | null;

    if (md?.onboardingCompleted !== true) {
      return NextResponse.json({ ok: false, error: "onboarding_not_completed" }, { status: 403 });
    }

    if (!isSummittSubscribedFromClerkMetadata(md)) {
      return NextResponse.json({ ok: false, error: "not_subscribed" }, { status: 403 });
    }

    if (await isUserFullyOnV2AccountabilityPath(userId)) {
      return NextResponse.json({ ok: false, error: "already_fully_on_v2" }, { status: 409 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const { title, behavior, success } = parsed;
    const nowIso = new Date().toISOString();

    const { data: activeRow, error: activeErr } = await supabaseServer
      .from("v2_commitment")
      .select("id, behavior_statement, source")
      .eq("clerk_user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (activeErr) {
      console.error("[v2/cutover/commitment] active select failed", activeErr);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    let commitmentId: string;

    if (activeRow?.id) {
      const existingBeh =
        typeof activeRow.behavior_statement === "string" ? activeRow.behavior_statement.trim() : "";
      if (existingBeh.length > 0) {
        return NextResponse.json({ ok: false, error: "already_fully_on_v2" }, { status: 409 });
      }

      const { error: updErr } = await supabaseServer
        .from("v2_commitment")
        .update({
          title,
          behavior_statement: behavior,
          success_criteria: success,
          updated_at: nowIso,
          source: "cutover_v1",
        })
        .eq("id", activeRow.id)
        .eq("clerk_user_id", userId)
        .eq("status", "active");

      if (updErr) {
        console.error("[v2/cutover/commitment] active update failed", updErr);
        return NextResponse.json({ ok: false, error: "Failed to update commitment" }, { status: 500 });
      }

      commitmentId = String(activeRow.id);
    } else {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("v2_commitment")
        .insert({
          clerk_user_id: userId,
          status: "active",
          title,
          commitment_type: "accountability",
          behavior_statement: behavior,
          success_criteria: success,
          cadence_kind: "daily",
          tone_preference: null,
          reachability_window: {},
          source: "cutover_v1",
          accountability_phase: "active_accountability",
        })
        .select("id")
        .maybeSingle();

      if (insErr || !inserted?.id) {
        console.error("[v2/cutover/commitment] insert failed", insErr);
        return NextResponse.json({ ok: false, error: "Failed to create commitment" }, { status: 500 });
      }

      commitmentId = String(inserted.id);
    }

    const idempotencyKey = `cutover_commitment_activated:${commitmentId}`;
    const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: commitmentId,
      clerk_user_id: userId,
      event_type: "activated",
      source: "cutover_v1",
      payload_json: {
        source: "legacy_cutover",
        action: "commitment_created_or_repaired",
      },
      idempotency_key: idempotencyKey,
    });

    if (evErr) {
      const code = (evErr as { code?: string }).code;
      if (code !== "23505") {
        console.error("[v2/cutover/commitment] event insert failed", evErr);
        return NextResponse.json({ ok: false, error: "Failed to record commitment event" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, commitmentId });
  } catch (err) {
    console.error("[v2/cutover/commitment]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

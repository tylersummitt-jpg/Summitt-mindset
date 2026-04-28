import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
  validateSuccessCriteriaIntake,
} from "@/lib/v2-commitment-intake-validation";

/**
 * POST /api/onboarding/commitment
 * Creates first V2 commitment as `proposed` + `created` event.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md?.onboardingCompleted === true) {
      return new Response(JSON.stringify({ error: "Onboarding already completed." }), {
        status: 403,
      });
    }

    const { data: existingActive } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (existingActive?.id) {
      return new Response(
        JSON.stringify({
          error: "Your commitment is already active. Continue to the final step to finish onboarding.",
        }),
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));

    const titleRaw = typeof body?.commitment_title === "string" ? body.commitment_title : "";
    const behaviorRaw =
      typeof body?.behavior_statement === "string" ? body.behavior_statement : "";

    const titleErr = validateCommitmentTitleIntake(titleRaw);
    if (titleErr) {
      return new Response(JSON.stringify({ error: titleErr }), { status: 400 });
    }

    const behaviorErr = validateBehaviorStatementIntake(behaviorRaw);
    if (behaviorErr) {
      return new Response(JSON.stringify({ error: behaviorErr }), { status: 400 });
    }

    const title = normalizeIntakeWhitespace(titleRaw);
    const behaviorStatement = normalizeIntakeWhitespace(behaviorRaw);

    let successCriteria: string | null = null;
    const successRaw = body?.success_criteria;
    if (typeof successRaw === "string" && successRaw.trim().length > 0) {
      const s = normalizeIntakeWhitespace(successRaw);
      const successErr = validateSuccessCriteriaIntake(s);
      if (successErr) {
        return new Response(JSON.stringify({ error: successErr }), { status: 400 });
      }
      successCriteria = s;
    }

    const { error: delErr } = await supabaseServer
      .from("v2_commitment")
      .delete()
      .eq("clerk_user_id", userId)
      .eq("status", "proposed");

    if (delErr) {
      console.error("[onboarding/commitment] delete proposed failed", delErr);
      return new Response(JSON.stringify({ error: "Failed to reset commitment draft" }), {
        status: 500,
      });
    }

    const { data: row, error: insertErr } = await supabaseServer
      .from("v2_commitment")
      .insert({
        clerk_user_id: userId,
        status: "proposed",
        title,
        commitment_type: "accountability",
        behavior_statement: behaviorStatement,
        success_criteria: successCriteria,
        cadence_kind: "daily",
        tone_preference: null,
        reachability_window: {},
        source: "onboarding_v2",
      })
      .select("id")
      .maybeSingle();

    if (insertErr || !row?.id) {
      console.error("[onboarding/commitment] insert failed", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save commitment" }), {
        status: 500,
      });
    }

    const commitmentId = row.id as string;

    const { error: eventErr } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: commitmentId,
      clerk_user_id: userId,
      event_type: "created",
      source: "onboarding_v2",
      payload_json: {},
      idempotency_key: `onboarding_commitment_created:${commitmentId}`,
    });

    if (eventErr) {
      console.error("[onboarding/commitment] event insert failed", eventErr);
      await supabaseServer.from("v2_commitment").delete().eq("id", commitmentId);
      return new Response(JSON.stringify({ error: "Failed to record commitment event" }), {
        status: 500,
      });
    }

    return Response.json({ ok: true, commitmentId });
  } catch (err) {
    console.error("[onboarding/commitment]", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
}

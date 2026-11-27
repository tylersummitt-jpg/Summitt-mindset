import { auth } from "@clerk/nextjs/server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import type { OnboardingDiagnosticErrorCode } from "@/lib/onboarding-journey-diagnostics";
import { recordOnboardingApiEvent } from "@/lib/onboarding-journey-diagnostics.server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
} from "@/lib/v2-commitment-intake-validation";
import {
  requireWeakAcceptForWarn,
  validateGoalBehaviorTiered,
  validateGoalTitleTiered,
} from "@/lib/onboarding-intake-validation";
import {
  buildCoherenceForCommitment,
  persistCommitmentSidecar,
} from "@/lib/onboarding-persist-commitment";
import { getTemplateById, isGoalAreaId } from "@/lib/onboarding-goal-templates";

function parseIntakeOrigin(
  raw: unknown
): "user_written" | "generated" | "template" | "recommended" {
  if (raw === "generated" || raw === "template" || raw === "recommended") return raw;
  return "user_written";
}

export async function POST(req: Request) {
  let diagnosticUserId: string | null = null;
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
    diagnosticUserId = userId;

    const note = (
      outcome: "request_received" | "validation_blocked" | "save_failed",
      errorCode: OnboardingDiagnosticErrorCode = "none"
    ) => recordOnboardingApiEvent({ request: req, clerkUserId: userId, step: "goal", outcome, errorCode });

    await note("request_received");

    const md = await getClerkPublicMetadata(userId);
    if (md?.onboardingCompleted === true) {
      await note("save_failed", "forbidden");
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
      await note("save_failed", "conflict");
      return new Response(
        JSON.stringify({
          error: "Your commitment is already active. Continue to the final step to finish onboarding.",
        }),
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const intakeWeakAccept = body?.intake_weak_accept === true;

    const titleRaw = typeof body?.commitment_title === "string" ? body.commitment_title : "";
    const behaviorRaw =
      typeof body?.behavior_statement === "string" ? body.behavior_statement : "";

    const titleTier = requireWeakAcceptForWarn(
      validateGoalTitleTiered(titleRaw, { intakeWeakAccept }),
      intakeWeakAccept
    );
    if (titleTier.tier === "block") {
      await note("validation_blocked", "invalid_title");
      return new Response(JSON.stringify({ error: titleTier.error }), { status: 400 });
    }
    if (titleTier.tier === "warn") {
      await note("validation_blocked", "invalid_title");
      return new Response(JSON.stringify({ error: titleTier.error }), { status: 400 });
    }

    const behaviorTier = requireWeakAcceptForWarn(
      validateGoalBehaviorTiered(behaviorRaw, { intakeWeakAccept }),
      intakeWeakAccept
    );
    if (behaviorTier.tier === "block") {
      await note("validation_blocked", "invalid_behavior");
      return new Response(JSON.stringify({ error: behaviorTier.error }), { status: 400 });
    }
    if (behaviorTier.tier === "warn") {
      await note("validation_blocked", "invalid_behavior");
      return new Response(JSON.stringify({ error: behaviorTier.error }), { status: 400 });
    }

    const titleErr = validateCommitmentTitleIntake(titleRaw);
    if (titleErr) {
      await note("validation_blocked", "invalid_title");
      return new Response(JSON.stringify({ error: titleErr }), { status: 400 });
    }

    const behaviorErr = validateBehaviorStatementIntake(behaviorRaw);
    if (behaviorErr) {
      await note("validation_blocked", "invalid_behavior");
      return new Response(JSON.stringify({ error: behaviorErr }), { status: 400 });
    }

    const selectedAreaId =
      typeof body?.selected_area_id === "string" ? body.selected_area_id : "";
    if (!isGoalAreaId(selectedAreaId)) {
      await note("validation_blocked", "missing_focus");
      return new Response(JSON.stringify({ error: "Choose a focus area for your goal." }), {
        status: 400,
      });
    }

    const selectedTemplateId =
      typeof body?.selected_template_id === "string" ? body.selected_template_id : null;
    if (selectedTemplateId && !getTemplateById(selectedTemplateId)) {
      await note("validation_blocked", "invalid_input");
      return new Response(JSON.stringify({ error: "Invalid goal template." }), { status: 400 });
    }

    const { data: profile } = await supabaseServer
      .from("user_profiles")
      .select("identity_anchor_text, active_identity_version_id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    const identityAnchor =
      typeof profile?.identity_anchor_text === "string"
        ? profile.identity_anchor_text.trim()
        : "";
    if (!identityAnchor || !profile?.active_identity_version_id) {
      await note("validation_blocked", "missing_identity");
      return new Response(
        JSON.stringify({ error: "Save your identity before choosing a goal." }),
        { status: 400 }
      );
    }

    const title = normalizeIntakeWhitespace(titleRaw);
    const behaviorStatement = normalizeIntakeWhitespace(behaviorRaw);

    const { error: delErr } = await supabaseServer
      .from("v2_commitment")
      .delete()
      .eq("clerk_user_id", userId)
      .eq("status", "proposed");

    if (delErr) {
      console.error("[onboarding/commitment] delete proposed failed", delErr);
      await note("save_failed", "persistence");
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
        success_criteria: null,
        cadence_kind: "daily",
        tone_preference: null,
        reachability_window: {},
        source: "onboarding_v2",
      })
      .select("id")
      .maybeSingle();

    if (insertErr || !row?.id) {
      console.error("[onboarding/commitment] insert failed", insertErr);
      await note("save_failed", "persistence");
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
      await note("save_failed", "persistence");
      return new Response(JSON.stringify({ error: "Failed to record commitment event" }), {
        status: 500,
      });
    }

    const coherence = buildCoherenceForCommitment({
      selectedAreaId,
      selectedTemplateId,
      intakeOrigin: parseIntakeOrigin(body?.intake_origin),
      useMineAnyway: intakeWeakAccept,
      identityVersionId: profile.active_identity_version_id as string,
      identityAnchor,
      goalTitle: title,
      goalBehavior: behaviorStatement,
      bridgeQuestionAsked:
        typeof body?.bridge_question_asked === "string" ? body.bridge_question_asked : null,
      userResponse: typeof body?.user_response === "string" ? body.user_response : null,
    });

    const sidecar = await persistCommitmentSidecar(
      {
        clerkUserId: userId,
        commitmentId,
        selectedAreaId,
        selectedTemplateId,
        intakeOrigin: parseIntakeOrigin(body?.intake_origin),
        useMineAnyway: intakeWeakAccept,
        identityVersionId: profile.active_identity_version_id as string,
        identityAnchor,
        goalTitle: title,
        goalBehavior: behaviorStatement,
        bridgeQuestionAsked:
          typeof body?.bridge_question_asked === "string" ? body.bridge_question_asked : null,
        userResponse: typeof body?.user_response === "string" ? body.user_response : null,
      },
      coherence
    );

    if (!sidecar.ok) {
      await supabaseServer.from("v2_commitment").delete().eq("id", commitmentId);
      await note("save_failed", "persistence");
      return new Response(JSON.stringify({ error: sidecar.error }), { status: 500 });
    }

    return Response.json({ ok: true, commitmentId });
  } catch (err) {
    console.error("[onboarding/commitment]", err);
    if (diagnosticUserId) {
      await recordOnboardingApiEvent({
        request: req,
        clerkUserId: diagnosticUserId,
        step: "goal",
        outcome: "save_failed",
        errorCode: "server",
      });
    }
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
}

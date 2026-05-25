import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { computeGoalCoherence, type CoherenceResult } from "@/lib/onboarding-coherence";
import { isGoalAreaId } from "@/lib/onboarding-goal-templates";

export type PersistCommitmentSidecarInput = {
  clerkUserId: string;
  commitmentId: string;
  selectedAreaId: string;
  selectedTemplateId: string | null;
  intakeOrigin: "user_written" | "generated" | "template" | "recommended";
  useMineAnyway: boolean;
  identityVersionId: string | null;
  identityAnchor: string;
  goalTitle: string;
  goalBehavior: string;
  bridgeQuestionAsked?: string | null;
  userResponse?: string | null;
};

export async function persistCommitmentSidecar(
  input: PersistCommitmentSidecarInput,
  coherence: CoherenceResult
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isGoalAreaId(input.selectedAreaId)) {
    return { ok: false, error: "Choose a focus area for your goal." };
  }

  const nowIso = new Date().toISOString();

  const { error: intakeErr } = await supabaseServer.from("v2_commitment_intake").insert({
    commitment_id: input.commitmentId,
    clerk_user_id: input.clerkUserId,
    selected_area_id: input.selectedAreaId,
    selected_template_id: input.selectedTemplateId,
    intake_origin: input.intakeOrigin,
    use_mine_anyway: input.useMineAnyway,
    checkability_score: coherence.checkabilityScore,
    coherence_status: coherence.coherenceStatus,
    sms_suitability: coherence.smsSuitability,
    identity_version_id: input.identityVersionId,
    updated_at: nowIso,
  });

  if (intakeErr) {
    console.error("[persist-commitment] intake insert failed", intakeErr);
    return { ok: false, error: "Failed to save goal details" };
  }

  if (!input.identityVersionId) {
    return { ok: false, error: "Identity must be saved before your goal." };
  }

  const { error: logErr } = await supabaseServer.from("goal_coherence_log").insert({
    clerk_user_id: input.clerkUserId,
    identity_version_id: input.identityVersionId,
    commitment_id: input.commitmentId,
    direct_connection_likely: coherence.directConnectionLikely,
    supporting_connection_likely: coherence.supportingConnectionLikely,
    confidence: coherence.confidence,
    bridge_question_asked: input.bridgeQuestionAsked ?? null,
    user_response: input.userResponse ?? null,
    coach_pat_note_generated: coherence.coachPatNoteGenerated,
    coach_pat_note_text: coherence.coachPatNoteText,
  });

  if (logErr) {
    console.error("[persist-commitment] coherence log insert failed", logErr);
    await supabaseServer.from("v2_commitment_intake").delete().eq("commitment_id", input.commitmentId);
    return { ok: false, error: "Failed to save goal coherence" };
  }

  return { ok: true };
}

export function buildCoherenceForCommitment(
  input: Omit<PersistCommitmentSidecarInput, "commitmentId" | "clerkUserId">
): CoherenceResult {
  return computeGoalCoherence({
    identityAnchor: input.identityAnchor,
    goalTitle: input.goalTitle,
    goalBehavior: input.goalBehavior,
    selectedAreaId: input.selectedAreaId,
    bridgeUserResponse: input.userResponse,
  });
}

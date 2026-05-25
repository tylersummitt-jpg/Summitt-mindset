import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isUserFullyOnV2AccountabilityPath } from "@/lib/v2-cutover-gates";
import {
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
} from "@/lib/v2-guided-resolution";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { deriveSeasonModeForSmsGoalChange } from "@/lib/v2-sms-season-mode";
import UpdateGoalClient from "./update-goal-client";

export const dynamic = "force-dynamic";

export default async function UpdateGoalPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const fullyOnV2 = await isUserFullyOnV2AccountabilityPath(userId);
  if (!fullyOnV2) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const commitment = await getActiveCommitment(userId);
  if (!commitment?.id) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  if (commitment.accountability_phase === "low_pressure_reactivation") {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const pending = getPendingResolutionOrNull(commitment);
  if (pending || isSmsInboundPendingResolutionActionable(commitment)) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const identityDraft = await loadIdentityEditDraft(userId);
  const identityAnchor = identityDraft.identityAnchorText?.trim() ?? "";
  if (!identityAnchor) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const nowMs = Date.now();
  const effectiveAsk = getEffectiveCoachingAsk(commitment, nowMs);
  const showSplitAsk =
    Boolean(effectiveAsk) &&
    effectiveAsk.trim().replace(/\s+/g, " ") !==
      commitment.behavior_statement.trim().replace(/\s+/g, " ");

  const defaultRecommendation = deriveSeasonModeForSmsGoalChange({
    rawBody: commitment.behavior_statement,
    candidateBar: commitment.behavior_statement,
    currentBehaviorStatement: commitment.behavior_statement,
  });

  return (
    <UpdateGoalClient
      identityAnchor={identityAnchor}
      personalizationContext={{
        ingredientIds: identityDraft.ingredientIds,
        importantPeople: identityDraft.importantPeople.map((person) => ({
          relationship_type: person.relationship_type,
        })),
        identityAnchor,
      }}
      currentBehaviorStatement={commitment.behavior_statement}
      effectiveCoachingAsk={showSplitAsk ? effectiveAsk : null}
      defaultRecommendedSeasonMode={defaultRecommendation.mode}
    />
  );
}

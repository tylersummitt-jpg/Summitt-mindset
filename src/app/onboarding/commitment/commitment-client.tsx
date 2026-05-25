"use client";

import type { ReactElement } from "react";
import GoalBuilderClient, {
  type GoalBuilderCopy,
} from "@/components/GoalBuilderClient";
import type { GoalAreaId } from "@/lib/onboarding-goal-templates";
import type { GoalPersonalizationInput } from "@/lib/onboarding-goal-personalization";

export type CommitmentClientInitial = {
  initialTitle?: string | null;
  initialBehaviorStatement?: string | null;
  initialSelectedAreaId?: GoalAreaId | "" | null;
  initialWarnMessage?: string | null;
  initialWeakAccept?: boolean;
  identityAnchor?: string | null;
  personalizationContext?: GoalPersonalizationInput;
};

export default function CommitmentClient({
  initialTitle,
  initialBehaviorStatement,
  initialSelectedAreaId = "",
  initialWarnMessage = null,
  initialWeakAccept = false,
  identityAnchor,
  personalizationContext = {},
}: CommitmentClientInitial = {}): ReactElement {
  const copy: GoalBuilderCopy = {
    focusAreaPrompt: "Choose one focus area",
    continueLabel: "Continue to Review →",
    backLabel: "Back",
  };

  return (
    <GoalBuilderClient
      mode="onboarding"
      identityAnchor={identityAnchor}
      personalizationContext={personalizationContext}
      generateEndpoint="/api/onboarding/generate-goal-options"
      initialTitle={initialTitle}
      initialBehaviorStatement={initialBehaviorStatement}
      initialSelectedAreaId={initialSelectedAreaId}
      initialWarnMessage={initialWarnMessage}
      initialWeakAccept={initialWeakAccept}
      backHref="/onboarding/identity"
      copy={copy}
    />
  );
}

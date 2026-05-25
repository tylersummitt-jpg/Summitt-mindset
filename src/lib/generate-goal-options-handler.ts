import "server-only";

import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";
import { generateGoalOptions } from "@/lib/onboarding-generation";
import { sanitizeGoalOptions } from "@/lib/onboarding-goal-quality";
import { isGoalAreaId } from "@/lib/onboarding-goal-templates";
import type { GoalPersonalizationInput } from "@/lib/onboarding-goal-personalization";

export type GenerateGoalOptionsResult =
  | { ok: true; options: { title: string; behaviorStatement: string }[] }
  | { ok: false; status: number; error: string };

export async function handleGenerateGoalOptionsRequest(
  clerkUserId: string,
  areaIdRaw: string
): Promise<GenerateGoalOptionsResult> {
  if (!isGoalAreaId(areaIdRaw)) {
    return { ok: false, status: 400, error: "Choose a focus area first." };
  }

  const draft = await loadIdentityEditDraft(clerkUserId);
  const identityAnchor = draft.identityAnchorText?.trim() ?? "";

  if (!identityAnchor) {
    return { ok: false, status: 400, error: "Save your identity first." };
  }

  const personalizationContext: GoalPersonalizationInput = {
    ingredientIds: draft.ingredientIds,
    importantPeople: draft.importantPeople.map((person) => ({
      relationship_type: person.relationship_type,
    })),
    identityAnchor,
  };

  let rawOptions: { title: string; behaviorStatement: string }[];
  try {
    rawOptions = await generateGoalOptions(areaIdRaw, personalizationContext);
  } catch (err) {
    console.error("[generate-goal-options] generation failed", err);
    return {
      ok: false,
      status: 503,
      error: "Could not generate goal options right now.",
    };
  }

  const options = sanitizeGoalOptions(rawOptions, identityAnchor, 5);
  if (options.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "Could not generate goal options right now.",
    };
  }

  return { ok: true, options };
}

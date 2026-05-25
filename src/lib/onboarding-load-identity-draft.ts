import "server-only";

import { normalizeIngredientIds } from "@/lib/onboarding-identity-templates";
import {
  isImportantPeopleRelationshipType,
  type ImportantPeopleRelationshipType,
} from "@/lib/onboarding-people-summary";
import { supabaseServer } from "@/lib/supabase-server";

export type IdentityOnboardingPersonRow = {
  display_name: string;
  relationship_type: ImportantPeopleRelationshipType;
};

export type IdentityOnboardingDraft = {
  ingredientIds: string[];
  otherText: string | null;
  importantPeople: IdentityOnboardingPersonRow[];
};

export async function loadIdentityOnboardingDraft(
  clerkUserId: string,
  activeIdentityVersionId: string | null | undefined
): Promise<IdentityOnboardingDraft> {
  let ingredientIds: string[] = [];
  let otherText: string | null = null;

  if (activeIdentityVersionId) {
    const { data: version } = await supabaseServer
      .from("user_identity_version")
      .select("ingredient_ids, other_text")
      .eq("id", activeIdentityVersionId)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    if (version) {
      ingredientIds = normalizeIngredientIds(version.ingredient_ids);
      const rawOther = version.other_text;
      otherText =
        typeof rawOther === "string" && rawOther.trim().length > 0 ? rawOther.trim() : null;
    }
  }

  const { data: peopleRows } = await supabaseServer
    .from("important_people")
    .select("display_name, relationship_type")
    .eq("clerk_user_id", clerkUserId)
    .eq("source", "onboarding")
    .eq("is_active", true)
    .is("removed_at", null);

  const importantPeople: IdentityOnboardingPersonRow[] = [];
  for (const row of peopleRows ?? []) {
    const name = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!name || !isImportantPeopleRelationshipType(row.relationship_type)) {
      continue;
    }
    importantPeople.push({
      display_name: name,
      relationship_type: row.relationship_type,
    });
  }

  return { ingredientIds, otherText, importantPeople };
}

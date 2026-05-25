import "server-only";

import { normalizeIngredientIds } from "@/lib/onboarding-identity-templates";
import {
  isImportantPeopleRelationshipType,
  type ImportantPeopleRelationshipType,
} from "@/lib/onboarding-people-summary";
import { supabaseServer } from "@/lib/supabase-server";

export type IdentityEditPersonRow = {
  display_name: string;
  relationship_type: ImportantPeopleRelationshipType;
};

export type IdentityEditDraft = {
  preferredName: string | null;
  identityAnchorText: string | null;
  activeIdentityVersionId: string | null;
  ingredientIds: string[];
  otherText: string | null;
  intakeOrigin: "user_written" | "generated" | "template" | null;
  useMineAnyway: boolean;
  clarityScore: number | null;
  importantPeople: IdentityEditPersonRow[];
};

const INTAKE_SOURCES = ["onboarding", "edit"] as const;

export async function loadIdentityEditDraft(clerkUserId: string): Promise<IdentityEditDraft> {
  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, identity_anchor_text, active_identity_version_id"
    )
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const activeIdentityVersionId =
    typeof profile?.active_identity_version_id === "string"
      ? profile.active_identity_version_id
      : null;

  let ingredientIds: string[] = [];
  let otherText: string | null = null;
  let intakeOrigin: IdentityEditDraft["intakeOrigin"] = null;
  let useMineAnyway = false;
  let clarityScore: number | null = null;

  if (activeIdentityVersionId) {
    const { data: version } = await supabaseServer
      .from("user_identity_version")
      .select(
        "ingredient_ids, other_text, intake_origin, use_mine_anyway, clarity_score"
      )
      .eq("id", activeIdentityVersionId)
      .eq("clerk_user_id", clerkUserId)
      .eq("is_active", true)
      .maybeSingle();

    if (version) {
      ingredientIds = normalizeIngredientIds(version.ingredient_ids);
      const rawOther = version.other_text;
      otherText =
        typeof rawOther === "string" && rawOther.trim().length > 0 ? rawOther.trim()
          : null;
      const origin = version.intake_origin;
      if (origin === "user_written" || origin === "generated" || origin === "template") {
        intakeOrigin = origin;
      }
      useMineAnyway = version.use_mine_anyway === true;
      if (
        typeof version.clarity_score === "number" &&
        Number.isFinite(version.clarity_score)
      ) {
        clarityScore = Math.round(version.clarity_score);
      }
    }
  }

  const { data: peopleRows } = await supabaseServer
    .from("important_people")
    .select("display_name, relationship_type, source")
    .eq("clerk_user_id", clerkUserId)
    .in("source", [...INTAKE_SOURCES])
    .eq("is_active", true)
    .is("removed_at", null);

  const importantPeople: IdentityEditPersonRow[] = [];
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

  const preferredName =
    typeof profile?.preferred_name === "string" && profile.preferred_name.trim().length > 0
      ? profile.preferred_name.trim()
      : null;

  const identityAnchorText =
    typeof profile?.identity_anchor_text === "string" &&
    profile.identity_anchor_text.trim().length > 0
      ? profile.identity_anchor_text.trim()
      : null;

  return {
    preferredName,
    identityAnchorText,
    activeIdentityVersionId,
    ingredientIds,
    otherText,
    intakeOrigin,
    useMineAnyway,
    clarityScore,
    importantPeople,
  };
}

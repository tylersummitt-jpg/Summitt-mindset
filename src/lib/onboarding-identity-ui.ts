import type { ImportantPeopleRelationshipType } from "@/lib/onboarding-people-summary";
import {
  isGrandparentCategoryIngredient,
  isParentCategoryIngredient,
  isSpouseCategoryIngredient,
} from "@/lib/onboarding-identity-templates";

export type ImportantPersonRow = {
  display_name: string;
  relationship_type: ImportantPeopleRelationshipType;
};

export type ImportantPeopleFieldValues = {
  kidsNames: string;
  spouseName: string;
  grandkidsNames: string;
  leadServeText: string;
};

export const WEAK_IDENTITY_PROMPT =
  "That works as a starting point. Want Coach Pat to make it stronger?";

export const WEAK_IDENTITY_SUGGESTIONS = [
  "I am becoming a disciplined, present version of myself.",
  "I am building the kind of life I can be proud of.",
  "I am choosing to become someone who keeps his word.",
] as const;

export function isGenericWeakIdentityAnchor(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return /\b(best version|best me|better person|better man|better woman)\b/.test(lower);
}

export function splitImportantPeopleNames(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function showsKidsNamesField(selectedIngredientIds: string[]): boolean {
  return selectedIngredientIds.some(isParentCategoryIngredient);
}

export function showsSpouseNameField(selectedIngredientIds: string[]): boolean {
  return selectedIngredientIds.some(isSpouseCategoryIngredient);
}

export function showsGrandkidsNamesField(selectedIngredientIds: string[]): boolean {
  return selectedIngredientIds.some(isGrandparentCategoryIngredient);
}

export function showsLeadServeField(selectedIngredientIds: string[]): boolean {
  return selectedIngredientIds.some((id) =>
    ["coach", "leader", "teacher_mentor"].includes(id)
  );
}

export function importantPeopleFieldsFromRows(
  rows: ImportantPersonRow[]
): ImportantPeopleFieldValues {
  const kids = rows
    .filter((r) => r.relationship_type === "child")
    .map((r) => r.display_name);
  const spouse = rows.find((r) => r.relationship_type === "spouse_partner")?.display_name ?? "";
  const grandkids = rows
    .filter((r) => r.relationship_type === "grandchild")
    .map((r) => r.display_name);
  const leadServe =
    rows.find((r) => r.relationship_type === "team_player_staff")?.display_name ?? "";

  return {
    kidsNames: kids.join(", "),
    spouseName: spouse,
    grandkidsNames: grandkids.join(", "),
    leadServeText: leadServe,
  };
}

export function buildImportantPeopleFromFields(
  selectedIngredientIds: string[],
  fields: ImportantPeopleFieldValues
): ImportantPersonRow[] {
  const out: ImportantPersonRow[] = [];

  if (showsKidsNamesField(selectedIngredientIds)) {
    for (const name of splitImportantPeopleNames(fields.kidsNames)) {
      out.push({
        display_name: name.slice(0, 40),
        relationship_type: "child",
      });
    }
  }

  if (showsSpouseNameField(selectedIngredientIds)) {
    const spouse = fields.spouseName.trim().slice(0, 40);
    if (spouse) {
      out.push({ display_name: spouse, relationship_type: "spouse_partner" });
    }
  }

  if (showsGrandkidsNamesField(selectedIngredientIds)) {
    for (const name of splitImportantPeopleNames(fields.grandkidsNames)) {
      out.push({
        display_name: name.slice(0, 40),
        relationship_type: "grandchild",
      });
    }
  }

  if (showsLeadServeField(selectedIngredientIds)) {
    const lead = fields.leadServeText.trim().slice(0, 120);
    if (lead) {
      out.push({ display_name: lead, relationship_type: "team_player_staff" });
    }
  }

  return out;
}

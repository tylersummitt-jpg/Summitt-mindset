/**
 * Relationship language for personalized onboarding goal recommendations.
 * Uses ingredient chips and relationship counts only — never raw display names.
 */

import { normalizeIngredientIds } from "@/lib/onboarding-identity-templates";
import { isImportantPeopleRelationshipType } from "@/lib/onboarding-people-summary";

export type GoalPersonalizationPerson = {
  relationship_type: string;
};

export type GoalPersonalizationInput = {
  ingredientIds?: string[];
  importantPeople?: GoalPersonalizationPerson[];
  identityAnchor?: string;
};

export type GoalRelationshipTerms = {
  partnerObject: string;
  partnerPronounObject: string;
  childObject: string;
  childrenCollective: string;
  eachChild: string;
  grandchildObject: string;
  grandchildrenCollective: string;
  leadGroupObject: string;
  leadMemberObject: string;
  familyMemberAtHome: string;
};

const DEFAULT_TERMS: GoalRelationshipTerms = {
  partnerObject: "my spouse or partner",
  partnerPronounObject: "them",
  childObject: "one of my kids",
  childrenCollective: "my kids",
  eachChild: "each of my kids",
  grandchildObject: "one of my grandkids",
  grandchildrenCollective: "my grandkids",
  leadGroupObject: "the people I lead",
  leadMemberObject: "someone I lead",
  familyMemberAtHome: "a family member",
};

function countRelationshipType(
  people: GoalPersonalizationPerson[],
  type: string
): number {
  return people.filter((p) => p.relationship_type === type).length;
}

function hasParentIngredient(ids: string[]): boolean {
  return ids.some((id) => ["dad", "mom", "parent"].includes(id));
}

function hasGrandparentIngredient(ids: string[]): boolean {
  return ids.some((id) => ["grandfather", "grandmother", "grandparent"].includes(id));
}

function resolvePartnerTerms(ids: string[]): Pick<
  GoalRelationshipTerms,
  "partnerObject" | "partnerPronounObject"
> {
  if (ids.includes("husband")) {
    return { partnerObject: "my wife", partnerPronounObject: "her" };
  }
  if (ids.includes("wife")) {
    return { partnerObject: "my husband", partnerPronounObject: "him" };
  }
  if (ids.includes("spouse") || ids.includes("spouse_partner")) {
    return { partnerObject: "my spouse", partnerPronounObject: "them" };
  }
  if (ids.includes("partner")) {
    return { partnerObject: "my partner", partnerPronounObject: "them" };
  }
  return {
    partnerObject: DEFAULT_TERMS.partnerObject,
    partnerPronounObject: DEFAULT_TERMS.partnerPronounObject,
  };
}

function resolveChildTerms(
  ids: string[],
  childCount: number
): Pick<GoalRelationshipTerms, "childObject" | "childrenCollective" | "eachChild"> {
  if (!hasParentIngredient(ids) && childCount === 0) {
    return {
      childObject: DEFAULT_TERMS.childObject,
      childrenCollective: DEFAULT_TERMS.childrenCollective,
      eachChild: DEFAULT_TERMS.eachChild,
    };
  }

  if (childCount === 1) {
    return {
      childObject: "my child",
      childrenCollective: "my child",
      eachChild: "my child",
    };
  }

  if (childCount > 1) {
    return {
      childObject: "one of my kids",
      childrenCollective: "my kids",
      eachChild: "each of my kids",
    };
  }

  return {
    childObject: "one of my kids",
    childrenCollective: "my kids",
    eachChild: "each of my kids",
  };
}

function resolveGrandchildTerms(
  ids: string[],
  grandchildCount: number
): Pick<GoalRelationshipTerms, "grandchildObject" | "grandchildrenCollective"> {
  if (!hasGrandparentIngredient(ids) && grandchildCount === 0) {
    return {
      grandchildObject: DEFAULT_TERMS.grandchildObject,
      grandchildrenCollective: DEFAULT_TERMS.grandchildrenCollective,
    };
  }

  if (grandchildCount === 1) {
    return {
      grandchildObject: "my grandchild",
      grandchildrenCollective: "my grandchild",
    };
  }

  return {
    grandchildObject: "one of my grandkids",
    grandchildrenCollective: "my grandkids",
  };
}

function resolveLeadTerms(
  ids: string[],
  hasTeamPeople: boolean
): Pick<GoalRelationshipTerms, "leadGroupObject" | "leadMemberObject"> {
  if (ids.includes("coach")) {
    return {
      leadGroupObject: "my players",
      leadMemberObject: "one of my players",
    };
  }
  if (ids.includes("teacher_mentor")) {
    return {
      leadGroupObject: "my students",
      leadMemberObject: "one of my students",
    };
  }
  if (ids.includes("leader")) {
    return {
      leadGroupObject: hasTeamPeople ? "my team" : "the people I lead",
      leadMemberObject: "someone I lead",
    };
  }
  if (hasTeamPeople) {
    return {
      leadGroupObject: "my staff",
      leadMemberObject: "someone on my team",
    };
  }
  return {
    leadGroupObject: DEFAULT_TERMS.leadGroupObject,
    leadMemberObject: DEFAULT_TERMS.leadMemberObject,
  };
}

export function resolveGoalRelationshipTerms(
  input: GoalPersonalizationInput = {}
): GoalRelationshipTerms {
  const ids = normalizeIngredientIds(input.ingredientIds ?? []);
  const people = (input.importantPeople ?? []).filter((p) =>
    isImportantPeopleRelationshipType(p.relationship_type)
  );

  const childCount = countRelationshipType(people, "child");
  const grandchildCount = countRelationshipType(people, "grandchild");
  const hasTeamPeople = countRelationshipType(people, "team_player_staff") > 0;

  return {
    ...DEFAULT_TERMS,
    ...resolvePartnerTerms(ids),
    ...resolveChildTerms(ids, childCount),
    ...resolveGrandchildTerms(ids, grandchildCount),
    ...resolveLeadTerms(ids, hasTeamPeople),
    familyMemberAtHome: hasParentIngredient(ids) ? "someone at home" : "a family member",
  };
}

const PLACEHOLDER_KEYS: (keyof GoalRelationshipTerms)[] = [
  "partnerObject",
  "partnerPronounObject",
  "childObject",
  "childrenCollective",
  "eachChild",
  "grandchildObject",
  "grandchildrenCollective",
  "leadGroupObject",
  "leadMemberObject",
  "familyMemberAtHome",
];

/** Replace {partnerObject}-style placeholders in goal copy. */
export function applyGoalPersonalization(
  text: string,
  terms: GoalRelationshipTerms
): string {
  let out = text;
  for (const key of PLACEHOLDER_KEYS) {
    out = out.replaceAll(`{${key}}`, terms[key]);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function formatGoalPersonalizationForPrompt(
  terms: GoalRelationshipTerms
): string {
  return [
    `Partner term: ${terms.partnerObject} (object pronoun: ${terms.partnerPronounObject})`,
    `Child term (one): ${terms.childObject}`,
    `Children collective: ${terms.childrenCollective}`,
    `Grandchild term (one): ${terms.grandchildObject}`,
    `Lead group: ${terms.leadGroupObject}`,
    `Lead individual: ${terms.leadMemberObject}`,
    "Use these relationship terms when relevant. Do not use generic 'spouse or partner' when a specific term is listed.",
    "Do not include private names.",
  ].join("\n");
}

export function personalizeGoalTemplateBehavior(
  templateId: string,
  behaviorStatement: string,
  ingredientIds: string[] = []
): string {
  const ids = normalizeIngredientIds(ingredientIds);

  if (templateId === "service_encourage" && !hasGrandparentIngredient(ids)) {
    return "I will encourage one person who is carrying a heavy load today.";
  }
  if (templateId === "family_encouragement" && hasGrandparentIngredient(ids)) {
    return "I will send one encouraging message to {grandchildObject} today.";
  }
  if (templateId === "family_presence_kid_time" && !hasParentIngredient(ids)) {
    return "I will give {familyMemberAtHome} ten uninterrupted minutes today.";
  }

  return behaviorStatement;
}

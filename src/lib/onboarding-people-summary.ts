/**
 * Safe people_summary mirror for legacy SMS readers (no display names).
 */

export const IMPORTANT_PEOPLE_RELATIONSHIP_TYPES = [
  "spouse_partner",
  "child",
  "grandchild",
  "team_player_staff",
  "family_member",
  "other",
] as const;

export type ImportantPeopleRelationshipType =
  (typeof IMPORTANT_PEOPLE_RELATIONSHIP_TYPES)[number];

export function isImportantPeopleRelationshipType(
  value: unknown
): value is ImportantPeopleRelationshipType {
  return (
    typeof value === "string" &&
    (IMPORTANT_PEOPLE_RELATIONSHIP_TYPES as readonly string[]).includes(value)
  );
}

const RELATIONSHIP_LABELS: Record<ImportantPeopleRelationshipType, string> = {
  spouse_partner: "a spouse/partner",
  child: "children",
  grandchild: "grandchildren",
  team_player_staff: "your team",
  family_member: "family",
  other: "the people who matter to you",
};

export type PeopleSummaryInput = {
  relationship_type: ImportantPeopleRelationshipType;
};

export function buildPeopleSummaryMirror(people: PeopleSummaryInput[]): string | null {
  if (!people.length) return null;

  const counts: Partial<Record<ImportantPeopleRelationshipType, number>> = {};
  for (const p of people) {
    counts[p.relationship_type] = (counts[p.relationship_type] ?? 0) + 1;
  }

  const parts: string[] = [];

  const spouse = counts.spouse_partner ?? 0;
  if (spouse > 0) {
    parts.push(spouse === 1 ? "a spouse/partner" : "spouse/partner");
  }

  const children = counts.child ?? 0;
  if (children > 0) {
    parts.push(children === 1 ? "1 child" : `${children} children`);
  }

  const grandchildren = counts.grandchild ?? 0;
  if (grandchildren > 0) {
    parts.push(grandchildren === 1 ? "1 grandchild" : `${grandchildren} grandchildren`);
  }

  const team = counts.team_player_staff ?? 0;
  if (team > 0) {
    parts.push(RELATIONSHIP_LABELS.team_player_staff);
  }

  const family = counts.family_member ?? 0;
  if (family > 0 && !spouse) {
    parts.push(family === 1 ? "family" : "family");
  }

  const other = counts.other ?? 0;
  if (other > 0 && parts.length === 0) {
    parts.push(RELATIONSHIP_LABELS.other);
  }

  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return `Showing up for ${parts[0]}`;
  }

  const last = parts.pop()!;
  return `Showing up for ${parts.join(", ")} and ${last}`;
}

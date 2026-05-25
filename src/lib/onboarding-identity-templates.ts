/**
 * Identity ingredient checklist + deterministic option templates.
 */

export const MAX_IDENTITY_INGREDIENTS = 6;

export const IDENTITY_PARENT_GROUP = ["dad", "mom", "parent"] as const;
export const IDENTITY_SPOUSE_GROUP = ["husband", "wife", "spouse", "partner"] as const;
export const IDENTITY_GRANDPARENT_GROUP = [
  "grandfather",
  "grandmother",
  "grandparent",
] as const;

/** Legacy stored id; resumes as Spouse. Not shown in checklist. */
export const LEGACY_SPOUSE_PARTNER_ID = "spouse_partner";

const PARENT_GROUP_SET = new Set<string>(IDENTITY_PARENT_GROUP);
const SPOUSE_GROUP_SET = new Set<string>([
  ...IDENTITY_SPOUSE_GROUP,
  LEGACY_SPOUSE_PARTNER_ID,
]);
const GRANDPARENT_GROUP_SET = new Set<string>(IDENTITY_GRANDPARENT_GROUP);

export const IDENTITY_INGREDIENTS = [
  { id: "dad", label: "Dad" },
  { id: "mom", label: "Mom" },
  { id: "parent", label: "Parent" },
  { id: "husband", label: "Husband" },
  { id: "wife", label: "Wife" },
  { id: "spouse", label: "Spouse" },
  { id: "partner", label: "Partner" },
  { id: "grandfather", label: "Grandfather" },
  { id: "grandmother", label: "Grandmother" },
  { id: "grandparent", label: "Grandparent" },
  { id: "provider", label: "Provider" },
  { id: "entrepreneur", label: "Entrepreneur / Business Owner" },
  { id: "career_work", label: "Career / Work" },
  { id: "leader", label: "Leader" },
  { id: "coach", label: "Coach" },
  { id: "teacher_mentor", label: "Teacher / Mentor" },
  { id: "student_learner", label: "Student / Learner" },
  { id: "person_of_faith", label: "Person of Faith" },
  { id: "health_fitness", label: "Health / Fitness" },
  { id: "discipline", label: "Discipline" },
  { id: "presence", label: "Presence" },
  { id: "focus", label: "Focus" },
  { id: "emotional_control", label: "Emotional Control" },
  { id: "consistency", label: "Consistency" },
  { id: "integrity", label: "Integrity" },
  { id: "courage", label: "Courage" },
  { id: "service", label: "Service" },
  { id: "friend_family", label: "Friend / Family Member" },
  { id: "caregiver", label: "Caregiver" },
  { id: "other", label: "Other" },
] as const;

export type IdentityIngredientId =
  | (typeof IDENTITY_INGREDIENTS)[number]["id"]
  | typeof LEGACY_SPOUSE_PARTNER_ID;

export const IDENTITY_INGREDIENT_OTHER_ID: IdentityIngredientId = "other";

const CHECKLIST_ID_SET = new Set<string>(IDENTITY_INGREDIENTS.map((i) => i.id));

const INGREDIENT_LABELS: Record<string, string> = Object.fromEntries(
  IDENTITY_INGREDIENTS.map((i) => [i.id, i.label])
);
INGREDIENT_LABELS[LEGACY_SPOUSE_PARTNER_ID] = "Spouse";

export type IdentityIngredientCategory = "parent" | "spouse_partner" | "grandparent";

export function getIngredientCategory(id: string): IdentityIngredientCategory | null {
  if (PARENT_GROUP_SET.has(id)) return "parent";
  if (SPOUSE_GROUP_SET.has(id)) return "spouse_partner";
  if (GRANDPARENT_GROUP_SET.has(id)) return "grandparent";
  return null;
}

export function isParentCategoryIngredient(id: string): boolean {
  return getIngredientCategory(id) === "parent";
}

export function isSpouseCategoryIngredient(id: string): boolean {
  return getIngredientCategory(id) === "spouse_partner";
}

export function isGrandparentCategoryIngredient(id: string): boolean {
  return getIngredientCategory(id) === "grandparent";
}

export function getMutualExclusiveGroupMembers(id: string): readonly string[] | null {
  if (PARENT_GROUP_SET.has(id)) return IDENTITY_PARENT_GROUP;
  if (SPOUSE_GROUP_SET.has(id)) return IDENTITY_SPOUSE_GROUP;
  if (GRANDPARENT_GROUP_SET.has(id)) return IDENTITY_GRANDPARENT_GROUP;
  return null;
}

export function isIdentityIngredientId(value: unknown): value is IdentityIngredientId {
  return (
    typeof value === "string" &&
    (CHECKLIST_ID_SET.has(value) || value === LEGACY_SPOUSE_PARTNER_ID)
  );
}

function migrateLegacyIngredientId(id: string): string {
  if (id === LEGACY_SPOUSE_PARTNER_ID) return "spouse";
  return id;
}

function sanitizeIngredientIdList(ids: string[]): string[] {
  return ids
    .map(migrateLegacyIngredientId)
    .filter((id) => CHECKLIST_ID_SET.has(id));
}

function dedupeMutualExclusiveGroups(ids: string[]): string[] {
  const ungrouped: string[] = [];
  const groupChoice = new Map<IdentityIngredientCategory, string>();

  for (const id of sanitizeIngredientIdList(ids)) {
    const category = getIngredientCategory(id);
    if (category) {
      groupChoice.set(category, id);
      continue;
    }
    if (!ungrouped.includes(id)) ungrouped.push(id);
  }

  const grouped: string[] = [];
  for (const cat of ["parent", "spouse_partner", "grandparent"] as const) {
    const chosen = groupChoice.get(cat);
    if (chosen) grouped.push(chosen);
  }
  return [...grouped, ...ungrouped];
}

export function normalizeIngredientIds(raw: unknown): IdentityIngredientId[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.filter((item): item is string => typeof item === "string");
  return dedupeMutualExclusiveGroups(items) as IdentityIngredientId[];
}

export function countSelectedIngredients(ids: string[]): number {
  return dedupeMutualExclusiveGroups(ids.filter((id): id is string => typeof id === "string"))
    .length;
}

export function toggleIdentityIngredient(
  selectedIds: string[],
  id: string
): { next: string[]; limitReached: boolean } {
  if (!CHECKLIST_ID_SET.has(id)) {
    return { next: selectedIds, limitReached: false };
  }

  const normalized = dedupeMutualExclusiveGroups(selectedIds);
  const groupMembers = getMutualExclusiveGroupMembers(id);

  if (normalized.includes(id)) {
    return { next: normalized.filter((x) => x !== id), limitReached: false };
  }

  let next = normalized;
  if (groupMembers) {
    next = normalized.filter((x) => !groupMembers.includes(x));
  }

  const replacingInGroup =
    groupMembers != null && normalized.some((x) => groupMembers.includes(x));

  if (!replacingInGroup && next.length >= MAX_IDENTITY_INGREDIENTS) {
    return { next: normalized, limitReached: true };
  }

  return { next: [...next, id], limitReached: false };
}

export function getIdentityIngredientLabel(id: IdentityIngredientId | string): string {
  const migrated = migrateLegacyIngredientId(id);
  return INGREDIENT_LABELS[migrated] ?? INGREDIENT_LABELS[id] ?? id;
}

/** Lowercase human-facing label for generation prompts (dad, husband, etc.). */
export function getIdentityIngredientGenerationLabel(id: IdentityIngredientId | string): string {
  return getIdentityIngredientLabel(id).toLowerCase();
}

const RELATIONSHIP_ROLE_IDS = new Set<string>([
  ...IDENTITY_PARENT_GROUP,
  ...IDENTITY_SPOUSE_GROUP,
  ...IDENTITY_GRANDPARENT_GROUP,
  LEGACY_SPOUSE_PARTNER_ID,
  "friend_family",
  "caregiver",
]);

const VOCATION_ROLE_IDS = new Set<string>([
  "provider",
  "entrepreneur",
  "career_work",
  "leader",
  "coach",
  "teacher_mentor",
  "student_learner",
]);

const FAITH_ROLE_IDS = new Set<string>(["person_of_faith"]);

const TRAIT_INGREDIENT_IDS = new Set<string>([
  "health_fitness",
  "discipline",
  "presence",
  "focus",
  "emotional_control",
  "consistency",
  "integrity",
  "courage",
  "service",
]);

const TRAIT_TO_ADJECTIVE: Record<string, string> = {
  presence: "present",
  discipline: "disciplined",
  focus: "focused",
  emotional_control: "steady",
  consistency: "consistent",
  integrity: "principled",
  courage: "courageous",
  service: "serving",
  health_fitness: "healthy",
};

const VOCATION_TO_PHRASE: Record<string, string> = {
  entrepreneur: "business owner",
  career_work: "professional",
  provider: "provider",
  leader: "leader",
  coach: "coach",
  teacher_mentor: "mentor",
  student_learner: "learner",
};

export type PartitionedIdentityIngredients = {
  relationshipRoles: string[];
  vocationRoles: string[];
  hasFaith: boolean;
  faithPhrase: string | null;
  traitAdjectives: string[];
  otherNote: string | null;
  familyLanguageHints: string[];
};

function vocationGenerationPhrase(id: string): string {
  return VOCATION_TO_PHRASE[id] ?? getIdentityIngredientGenerationLabel(id);
}

function traitGenerationAdjective(id: string): string {
  return TRAIT_TO_ADJECTIVE[id] ?? getIdentityIngredientGenerationLabel(id);
}

function faithPhraseForRoles(relationshipRoles: string[]): string {
  const ids = relationshipRoles.join(" ");
  if (/\b(wife|mom|mother|grandmother)\b/.test(ids)) return "faithful woman";
  if (/\b(husband|dad|father|grandfather)\b/.test(ids)) return "faithful man";
  return "person of faith";
}

/** Derive generic family phrasing from counts mirror — never private names. */
export function deriveFamilyLanguageHints(
  ingredientIds: string[],
  peopleSummaryMirror: string | null | undefined
): string[] {
  const hints = new Set<string>();
  const mirror = (peopleSummaryMirror ?? "").toLowerCase();

  if (ingredientIds.some(isParentCategoryIngredient) || mirror.includes("child")) {
    hints.add("my children");
  }
  if (ingredientIds.some(isGrandparentCategoryIngredient) || mirror.includes("grandchild")) {
    hints.add("my grandchildren");
  }
  if (ingredientIds.includes("husband")) hints.add("my wife");
  if (ingredientIds.includes("wife")) hints.add("my husband");
  if (ingredientIds.some(isSpouseCategoryIngredient)) hints.add("my family");
  if (mirror.includes("team") || ingredientIds.some((id) => ["coach", "leader", "teacher_mentor"].includes(id))) {
    hints.add("the people I lead");
  }
  if (hints.size === 0 && (mirror.includes("family") || ingredientIds.includes("friend_family"))) {
    hints.add("my family");
  }
  return [...hints];
}

export function partitionIngredientsForGeneration(
  ingredientIds: IdentityIngredientId[],
  options?: { otherText?: string | null; peopleSummaryMirror?: string | null }
): PartitionedIdentityIngredients {
  const relationshipRoles: string[] = [];
  const vocationRoles: string[] = [];
  const traitAdjectives: string[] = [];
  let hasFaith = false;
  let otherNote: string | null = null;

  for (const rawId of ingredientIds) {
    const id = migrateLegacyIngredientId(rawId);
    if (id === "other") continue;

    if (RELATIONSHIP_ROLE_IDS.has(id)) {
      relationshipRoles.push(getIdentityIngredientGenerationLabel(id));
      continue;
    }
    if (VOCATION_ROLE_IDS.has(id)) {
      vocationRoles.push(vocationGenerationPhrase(id));
      continue;
    }
    if (FAITH_ROLE_IDS.has(id)) {
      hasFaith = true;
      continue;
    }
    if (TRAIT_INGREDIENT_IDS.has(id)) {
      traitAdjectives.push(traitGenerationAdjective(id));
    }
  }

  const faithPhrase = hasFaith ? faithPhraseForRoles(relationshipRoles) : null;

  return {
    relationshipRoles,
    vocationRoles,
    hasFaith,
    faithPhrase,
    traitAdjectives,
    otherNote:
      typeof options?.otherText === "string" && options.otherText.trim()
        ? options.otherText.trim()
        : null,
    familyLanguageHints: deriveFamilyLanguageHints(
      ingredientIds.map(migrateLegacyIngredientId),
      options?.peopleSummaryMirror
    ),
  };
}

function possessiveForRoles(relationshipRoles: string[]): "his" | "her" | "their" {
  const joined = relationshipRoles.join(" ");
  if (/\b(wife|mom|mother|grandmother)\b/.test(joined)) return "her";
  if (/\b(husband|dad|father|grandfather)\b/.test(joined)) return "his";
  return "their";
}

function vocationListLabel(id: string): string {
  if (id === "entrepreneur") return "entrepreneur";
  return vocationGenerationPhrase(id);
}

export type IngredientGenerationMaterial = PartitionedIdentityIngredients & {
  /** One label per selected role chip, in selection order. */
  selectedRoleLabels: string[];
  hasEntrepreneur: boolean;
  hasLeader: boolean;
  possessive: "his" | "her" | "their";
  traitBehaviorPhrase: string;
  traitLeadPhrase: string;
};

export function buildIngredientGenerationMaterial(
  ingredientIds: IdentityIngredientId[],
  options?: { otherText?: string | null; peopleSummaryMirror?: string | null }
): IngredientGenerationMaterial {
  const partition = partitionIngredientsForGeneration(ingredientIds, options);
  const selectedRoleLabels: string[] = [];
  let hasEntrepreneur = false;
  let hasLeader = false;

  for (const rawId of ingredientIds) {
    const id = migrateLegacyIngredientId(rawId);
    if (id === "other") continue;
    if (RELATIONSHIP_ROLE_IDS.has(id)) {
      selectedRoleLabels.push(getIdentityIngredientGenerationLabel(id));
      continue;
    }
    if (id === "person_of_faith") {
      selectedRoleLabels.push("person of faith");
      continue;
    }
    if (VOCATION_ROLE_IDS.has(id)) {
      if (id === "entrepreneur") hasEntrepreneur = true;
      if (id === "leader") hasLeader = true;
      selectedRoleLabels.push(vocationListLabel(id));
    }
  }

  const possessive = possessiveForRoles(partition.relationshipRoles);
  const traitBehaviorPhrase = buildTraitBehaviorPhrase(
    ingredientIds.map(migrateLegacyIngredientId),
    possessive
  );
  const traitLeadPhrase = buildTraitLeadPhrase(partition.traitAdjectives);

  return {
    ...partition,
    selectedRoleLabels,
    hasEntrepreneur,
    hasLeader,
    possessive,
    traitBehaviorPhrase,
    traitLeadPhrase,
  };
}

function buildTraitLeadPhrase(adjectives: string[]): string {
  const set = new Set(adjectives);
  if (set.has("disciplined") && set.has("consistent")) return "steady follow-through";
  if (set.has("disciplined")) return "disciplined follow-through";
  if (set.has("consistent")) return "consistent follow-through";
  if (adjectives.length >= 2) return `${adjectives[0]} and ${adjectives[1]}`;
  return adjectives[0] ?? "follow-through";
}

function buildTraitBehaviorPhrase(
  ingredientIds: string[],
  possessive: "his" | "her" | "their"
): string {
  const ids = new Set(ingredientIds);
  if (ids.has("discipline") && ids.has("consistency")) {
    return `keeps ${possessive} word and follows through`;
  }
  if (ids.has("integrity")) {
    return `keeps ${possessive} word`;
  }
  if (ids.has("discipline")) return "follows through";
  if (ids.has("consistency")) return "keeps showing up";
  if (ids.has("courage") && ids.has("service")) return "serves with courage";
  if (ids.has("service")) return "serves others well";
  if (ids.has("courage")) return "does hard things with courage";
  const adjs = [...ids]
    .filter((id) => TRAIT_INGREDIENT_IDS.has(id))
    .map((id) => traitGenerationAdjective(id));
  if (adjs.length >= 2) return `${adjs[0]} and ${adjs[1]} in what matters`;
  if (adjs.length === 1) return `${adjs[0]} in what matters`;
  return "follows through";
}

/** Test helper: whether a line reflects a selected role chip or strong equivalent. */
export function lineReflectsRoleChip(line: string, roleLabel: string): boolean {
  const lower = line.toLowerCase();
  const equivalents: Record<string, RegExp> = {
    entrepreneur: /\b(entrepreneur|business owner|business)\b/i,
    leader: /\bleader\b/i,
    "business owner": /\b(business owner|entrepreneur|business)\b/i,
    "person of faith": /\b(faith|faithful|person of faith)\b/i,
  };
  const rx = equivalents[roleLabel] ?? new RegExp(`\\b${roleLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return rx.test(lower);
}

function buildAdjectivedRoleSegments(material: IngredientGenerationMaterial): string[] {
  const segments: string[] = [];
  let traitIdx = 0;
  const fallbacks = ["disciplined", "steady", "consistent", "focused", "principled"];

  for (const role of material.relationshipRoles) {
    const spouseRole = /\b(husband|wife|spouse|partner)\b/.test(role);
    let adj: string;
    if (spouseRole) {
      adj = material.traitAdjectives.includes("present") ? "present" : "steady";
    } else {
      adj = pickTrait(material.traitAdjectives, traitIdx, fallbacks[traitIdx] ?? "disciplined");
    }
    segments.push(`${adj} ${role}`);
    traitIdx += 1;
  }

  if (material.hasFaith && material.faithPhrase) {
    segments.push(material.faithPhrase);
  }

  if (material.hasEntrepreneur && material.hasLeader) {
    segments.push(
      `${pickTrait(material.traitAdjectives, traitIdx++, "consistent")} business leader`
    );
  } else {
    for (const role of material.vocationRoles) {
      const adj = pickTrait(material.traitAdjectives, traitIdx, fallbacks[traitIdx] ?? "disciplined");
      segments.push(`${adj} ${role}`);
      traitIdx += 1;
    }
  }

  return segments;
}

function formatRoleList(roles: string[]): string {
  if (roles.length === 0) return "someone who follows through";
  if (roles.length === 1) return roles[0]!;
  if (roles.length === 2) return `${roles[0]} and ${roles[1]}`;
  return `${roles.slice(0, -1).join(", ")}, and ${roles[roles.length - 1]}`;
}

function pickTrait(traits: string[], index: number, fallback: string): string {
  return traits[index] ?? fallback;
}

function vocationNounForSentence(phrase: string): string {
  return phrase === "business owner" ? "business" : phrase;
}

export function buildIdentityGenerationPromptBlock(ctx: IdentityGenerationContext): string {
  const material = buildIngredientGenerationMaterial(ctx.ingredientIds, {
    otherText: ctx.otherText,
    peopleSummaryMirror: ctx.peopleSummaryMirror,
  });

  return [
    "The selected identity chips are the user's raw material — not vague inspiration.",
    "Do not ignore selected ingredients. Every line must honor them directly or with clear equivalents.",
    "Include all selected role chips in each line when possible (dad, mom, husband, wife, entrepreneur, leader, coach, person of faith, etc.).",
    "Convert trait chips into natural identity language (disciplined, present, consistent, faithful, courageous, serving).",
    "At least one line must include all or nearly all selected chips. Most lines must include most selected chips.",
    "You may combine chips naturally (entrepreneur + leader → business leader; discipline + consistency → follow-through).",
    "Never list private names; use my children, my spouse, my family, my team.",
    "Avoid generic lines (no 'best me', 'be better', 'good person', 'building success').",
    "Do not quote Pat Summitt.",
    ctx.userWrittenWords
      ? "User draft words may refine tone but must not replace or drop selected chips."
      : "",
    material.selectedRoleLabels.length
      ? `Required role chips: ${material.selectedRoleLabels.join(", ")}`
      : "",
    material.traitAdjectives.length
      ? `Required trait language: ${material.traitAdjectives.join(", ")}`
      : "",
    material.hasEntrepreneur && material.hasLeader
      ? "May combine entrepreneur + leader as business leader in some lines, but include both roles across options."
      : "",
    material.familyLanguageHints.length
      ? `Family phrasing (no names): ${material.familyLanguageHints.join(", ")}`
      : "",
    ctx.peopleSummaryMirror ? `Important people counts only: ${ctx.peopleSummaryMirror}` : "",
    material.otherNote ? `Other ingredient note: ${material.otherNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const GENERIC_IDENTITY_PATTERNS = [
  /\bbest me\b/i,
  /\bbest version\b/i,
  /\bbe better\b/i,
  /\bgood person\b/i,
  /\bimprove\b/i,
];

export function isGenericIdentityOption(text: string): boolean {
  return GENERIC_IDENTITY_PATTERNS.some((rx) => rx.test(text));
}

export type IdentityGenerationContext = {
  preferredName: string;
  ingredientIds: IdentityIngredientId[];
  otherText?: string | null;
  peopleSummaryMirror?: string | null;
  /** Current identity statement textarea draft; not persisted until Continue. */
  userWrittenWords?: string | null;
};

export function buildDeterministicIdentityOptions(
  ctx: IdentityGenerationContext
): string[] {
  const material = buildIngredientGenerationMaterial(ctx.ingredientIds, {
    otherText: ctx.otherText,
    peopleSummaryMirror: ctx.peopleSummaryMirror,
  });

  const { relationshipRoles, traitAdjectives, selectedRoleLabels } = material;

  const options: string[] = [];

  const adjectivedSegments = buildAdjectivedRoleSegments(material);
  if (adjectivedSegments.length > 0) {
    options.push(`I am becoming a ${formatRoleList(adjectivedSegments)}.`);
  }

  if (selectedRoleLabels.length > 0) {
    options.push(
      `I am a ${formatRoleList(selectedRoleLabels)} who ${material.traitBehaviorPhrase}.`
    );
  }

  if (relationshipRoles.length > 0 || material.hasEntrepreneur || material.vocationRoles.length > 0) {
    const traitNounJoin =
      traitAdjectives.length >= 2
        ? `${traitAdjectives[0] === "disciplined" ? "discipline" : traitAdjectives[0]} and ${traitAdjectives[1] === "consistent" ? "consistency" : traitAdjectives[1]}`
        : traitAdjectives[0] === "disciplined"
          ? "discipline"
          : traitAdjectives[0] ?? "discipline and consistency";
    options.push(
      `I am building a life as a ${formatRoleList(selectedRoleLabels)} built on ${traitNounJoin}.`
    );
  }

  if (relationshipRoles.length > 0 || material.hasEntrepreneur) {
    const choosingRoles = [
      ...relationshipRoles.slice().reverse(),
      ...(material.hasEntrepreneur ? ["entrepreneur"] : []),
      ...(material.hasLeader ? ["leader"] : []),
    ];
    options.push(
      `I am choosing to be a ${formatRoleList(choosingRoles)} who leads with ${material.traitLeadPhrase}.`
    );
  }

  if (material.hasLeader || material.vocationRoles.length > 0) {
    const leaderTrait = pickTrait(traitAdjectives, 1, "consistent");
    const leaderScope =
      relationshipRoles.length > 0 && (material.hasEntrepreneur || material.vocationRoles.length > 0)
        ? "home and in business"
        : relationshipRoles.length > 0
          ? "home"
          : "business";
    options.push(
      `I am working to become a ${leaderTrait} ${formatRoleList(selectedRoleLabels)} at ${leaderScope}.`
    );
  }

  if (material.hasFaith && relationshipRoles.length > 0) {
    options.push(
      `I am a ${formatRoleList(relationshipRoles)} and ${material.faithPhrase ?? "person of faith"} who leads with ${material.traitLeadPhrase}.`
    );
  }

  const unique = [...new Set(options.map((o) => o.trim()))].filter(
    (line) => !isGenericIdentityOption(line)
  );
  return unique.slice(0, 5);
}

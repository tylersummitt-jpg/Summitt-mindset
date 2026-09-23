/** Bounds for one Finish/Continue submission. Personal Brand's final step saves its reflections. */
export const MAX_CONTINUE_REFLECTIONS = 40;
export const MAX_CONTINUE_QUIZ_ANSWERS = 20;
export const MAX_CONTINUE_SORT_PLACEMENTS = 20;

export type ContinuePayload = {
  miniProgramId: string;
  stepId: string;
  reflections: Record<string, string>;
  quizAnswers: Record<string, string[]>;
  sortPlacements: Record<string, string>;
};

export function parseContinuePayload(input: unknown): ContinuePayload | null {
  if (!isRecord(input)) return null;
  const miniProgramId = readId(input.miniProgramId);
  const stepId = readId(input.stepId);
  const reflections = readStringMap(input.reflections, MAX_CONTINUE_REFLECTIONS);
  const quizAnswers = readChoiceMap(input.quizAnswers, MAX_CONTINUE_QUIZ_ANSWERS);
  const sortPlacements = readStringMap(input.sortPlacements, MAX_CONTINUE_SORT_PLACEMENTS);
  if (!miniProgramId || !stepId || !reflections || !quizAnswers || !sortPlacements) return null;
  return { miniProgramId, stepId, reflections, quizAnswers, sortPlacements };
}

function readChoiceMap(value: unknown, maxEntries: number): Record<string, string[]> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > maxEntries) return null;
  const map: Record<string, string[]> = {};
  for (const [key, choices] of entries) {
    if (!readId(key)) return null;
    if (!Array.isArray(choices) || choices.length > 20) return null;
    const ids: string[] = [];
    for (const choice of choices) {
      const id = readId(choice);
      if (!id) return null;
      ids.push(id);
    }
    map[key] = ids;
  }
  return map;
}

function readStringMap(value: unknown, maxEntries: number): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > maxEntries) return null;
  const map: Record<string, string> = {};
  for (const [key, answer] of entries) {
    if (!readId(key)) return null;
    if (typeof answer !== "string" || answer.length > 4500) return null;
    map[key] = answer;
  }
  return map;
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

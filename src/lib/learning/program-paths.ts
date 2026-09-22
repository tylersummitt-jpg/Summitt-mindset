/**
 * Human routes for curated Programs.
 * Stored progress ids stay on the mini-program and step ids from the curriculum.
 * Adding a later principle means adding one entry here and one registry record.
 */

export const LEARNING_PROGRAM_ROUTES = [
  {
    miniProgramId: "dd_mp_02",
    collectionSlug: "definite-dozen",
    programSlug: "respect-yourself-and-others",
  },
  {
    miniProgramId: "dd_mp_03",
    collectionSlug: "definite-dozen",
    programSlug: "take-full-responsibility",
  },
  {
    miniProgramId: "dd_mp_04",
    collectionSlug: "definite-dozen",
    programSlug: "develop-and-demonstrate-loyalty",
  },
  {
    miniProgramId: "dd_mp_05",
    collectionSlug: "definite-dozen",
    programSlug: "learn-to-be-a-great-communicator",
  },
  {
    miniProgramId: "dd_mp_06",
    collectionSlug: "definite-dozen",
    programSlug: "discipline-yourself-so-no-one-else-has-to",
  },
  {
    miniProgramId: "dd_mp_07",
    collectionSlug: "definite-dozen",
    programSlug: "make-hard-work-your-passion",
  },
  {
    miniProgramId: "dd_mp_08",
    collectionSlug: "definite-dozen",
    programSlug: "dont-just-work-hard-work-smart",
  },
  {
    miniProgramId: "dd_mp_09",
    collectionSlug: "definite-dozen",
    programSlug: "put-the-team-before-yourself",
  },
  {
    miniProgramId: "dd_mp_10",
    collectionSlug: "definite-dozen",
    programSlug: "make-winning-an-attitude",
  },
  {
    miniProgramId: "dd_mp_11",
    collectionSlug: "definite-dozen",
    programSlug: "be-a-competitor",
  },
  {
    miniProgramId: "dd_mp_12",
    collectionSlug: "definite-dozen",
    programSlug: "change-is-a-must",
  },
  {
    miniProgramId: "dd_mp_13",
    collectionSlug: "definite-dozen",
    programSlug: "handle-success-like-you-handle-failure",
  },
] as const;

export type LearningProgramRoute = (typeof LEARNING_PROGRAM_ROUTES)[number];

export function learningProgramEntryPath(miniProgramId: string): string {
  const route = routeForProgram(miniProgramId);
  return `/programs/${route.collectionSlug}/${route.programSlug}`;
}

export function learningStepPath(miniProgramId: string, stepId: string): string {
  return `${learningProgramEntryPath(miniProgramId)}/${stepId}`;
}

export function resolveLearningRoute(
  collectionSlug: string,
  programSlug: string
): string | null {
  const route = LEARNING_PROGRAM_ROUTES.find(
    (item) => item.collectionSlug === collectionSlug && item.programSlug === programSlug
  );
  return route?.miniProgramId ?? null;
}

function routeForProgram(miniProgramId: string): LearningProgramRoute {
  const route = LEARNING_PROGRAM_ROUTES.find((item) => item.miniProgramId === miniProgramId);
  if (!route) {
    throw new Error(`No Programs route for ${miniProgramId}`);
  }
  return route;
}

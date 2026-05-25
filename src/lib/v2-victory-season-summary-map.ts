import {
  getRecentProofCategoryLabel,
  inferRecentProofCategory,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

export type SeasonSummaryConfidence = "none" | "low" | "medium" | "high";

export type SeasonSummaryBuildInput = {
  seasonStatus: string;
  proofMoments: VictoryMoment[];
  proofMomentCount: number;
  patternText: string | null;
  patternConfidence: "none" | "low" | "medium" | "high";
  principleLivedTitle: string | null;
};

export type SeasonSummaryBuildResult = {
  summaryText: string | null;
  strongestProofMomentId: string | null;
  patternText: string | null;
  principleLivedTitle: string | null;
  confidence: SeasonSummaryConfidence;
};

const GAMIFICATION =
  /\b(achievement|badge|unlocked|level|score|streak|leaderboard|points)\b/i;

function isActiveSeason(status: string): boolean {
  return status === "active";
}

function isClosedSeason(status: string): boolean {
  return status === "completed" || status === "archived";
}

function isKeptGoalCategory(moment: VictoryMoment): boolean {
  const c = inferRecentProofCategory(moment);
  return c === "showed_up" || c === "kept_the_thread_alive";
}

export function seasonSummaryThresholdMet(moments: VictoryMoment[]): boolean {
  if (moments.length >= 3) return true;

  const categories = new Set(
    moments.map((m) => inferRecentProofCategory(m))
  );
  const hasNonKeptGoal = moments.some((m) => !isKeptGoalCategory(m));
  return categories.size >= 2 && hasNonKeptGoal;
}

function assertCleanSummary(text: string) {
  if (GAMIFICATION.test(text)) {
    throw new Error(`Disallowed gamification in season summary: ${text}`);
  }
  if (
    /pat said/i.test(text) ||
    /coach pat saw/i.test(text) ||
    /you mastered/i.test(text) ||
    /transformational/i.test(text)
  ) {
    throw new Error(`Disallowed season summary phrasing: ${text}`);
  }
  if (/\byou always\b/i.test(text) || /\byou never\b/i.test(text)) {
    throw new Error(`Disallowed absolute claim in season summary: ${text}`);
  }
}

function pickStrongestMoment(moments: VictoryMoment[]): VictoryMoment | null {
  if (moments.length === 0) return null;
  const ranked = [...moments].sort((a, b) => {
    const catA = inferRecentProofCategory(a);
    const catB = inferRecentProofCategory(b);
    const strong = (c: string) =>
      c === "came_back" || c === "told_the_truth" || c === "adjusted_wisely" || c === "raised_the_bar";
    if (strong(catA) !== strong(catB)) {
      return strong(catB) ? 1 : -1;
    }
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
  return ranked[0] ?? null;
}

function categoryPhrases(moments: VictoryMoment[]): string[] {
  const labels = moments
    .map((m) => getRecentProofCategoryLabel(m).toLowerCase())
    .filter((l, i, arr) => arr.indexOf(l) === i)
    .slice(0, 3);
  return labels;
}

export function buildDeterministicSeasonSummary(
  input: SeasonSummaryBuildInput
): SeasonSummaryBuildResult {
  const empty: SeasonSummaryBuildResult = {
    summaryText: null,
    strongestProofMomentId: null,
    patternText: null,
    principleLivedTitle: null,
    confidence: "none",
  };

  if (isActiveSeason(input.seasonStatus)) {
    return empty;
  }

  if (!isClosedSeason(input.seasonStatus)) {
    return empty;
  }

  if (!seasonSummaryThresholdMet(input.proofMoments)) {
    return { ...empty, confidence: input.proofMoments.length > 0 ? "low" : "none" };
  }

  const strongest = pickStrongestMoment(input.proofMoments);
  const phrases = categoryPhrases(input.proofMoments);
  const phraseList =
    phrases.length >= 2
      ? `${phrases[0]} and ${phrases[1]}`
      : phrases[0] ?? "honest check-ins";

  const strongestLine = strongest
    ? ` The strongest moment was ${strongest.body.trim().replace(/\s+/g, " ").slice(0, 120)}.`
    : "";

  let summaryText = `This season saved proof that you ${phraseList}.${strongestLine}`;
  summaryText = summaryText.trim();

  const patternText =
    input.patternConfidence === "medium" || input.patternConfidence === "high"
      ? input.patternText?.trim() || null
      : null;

  const principleLivedTitle = input.principleLivedTitle?.trim() || null;

  if (summaryText.length > 480) {
    summaryText = `${summaryText.slice(0, 477)}…`;
  }

  assertCleanSummary(summaryText);

  const confidence: SeasonSummaryConfidence =
    input.proofMoments.length >= 4 ? "high" : "medium";

  return {
    summaryText,
    strongestProofMomentId: strongest?.id ?? null,
    patternText,
    principleLivedTitle,
    confidence,
  };
}

export function truncateSummaryTeaser(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

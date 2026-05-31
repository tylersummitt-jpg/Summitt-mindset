import {
  getVictoryProofCategoryTone,
  type VictoryProofCategoryToneKey,
} from "@/components/victory-room-visual";

export const VICTORY_CARD_PAT_QUOTE_FALLBACK = "Do not compromise your principles.";

/** Category-keyed Pat Summitt closing lines for Victory Card export. Edit copy here. */
export const VICTORY_CARD_PAT_QUOTES: Record<VictoryProofCategoryToneKey, string> = {
  kept_the_goal: "Have a plan and work it.",
  told_the_truth: "Discipline yourself so no one else has to.",
  got_back_on_track: "Attitude is a choice. Think positive thoughts daily.",
  adjusted_wisely: "Don't just work hard, work smart.",
  raised_the_bar: "Change is a must if you want to be your best.",
  completed_season: "Have pride in your work.",
};

/**
 * Resolves the Pat Summitt footer quote for a Victory Card from its display category label.
 * Uses the same category normalization as Recent Proof / share tones.
 */
export function getVictoryCardPatQuote(categoryLabel: string): string {
  const key = getVictoryProofCategoryTone(categoryLabel).key;
  return VICTORY_CARD_PAT_QUOTES[key] ?? VICTORY_CARD_PAT_QUOTE_FALLBACK;
}

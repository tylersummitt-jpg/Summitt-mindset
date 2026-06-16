/**
 * Victory Room display-only helpers — card copy resolution.
 * Client-safe: no Supabase or server-only view imports.
 */

import {
  isSelfExplanatoryProofQuote,
  proofTextsAreDuplicateForDisplay,
} from "@/lib/v2-victory-proof-quote";

export type VictoryMomentDisplayInput = {
  headline: string;
  body: string;
  quote?: string | null;
  meaning?: string | null;
};

export type VictoryMomentDisplaySurface = "home" | "allProof" | "share";

export type VictoryMomentCardDisplay = {
  primaryText: string;
  secondaryText: string | null;
  showQuoteMarks: boolean;
  mutedReceiptText: string | null;
};

function primaryMeaningFallback(moment: VictoryMomentDisplayInput): string {
  const meaning = (moment.meaning ?? moment.body).trim();
  if (meaning) return meaning;
  const headline = moment.headline.trim();
  if (headline) return headline;
  const quote = moment.quote?.trim();
  if (quote) return quote;
  return "Proof";
}

export function resolveVictoryMomentCardDisplay(
  moment: VictoryMomentDisplayInput,
  surface: VictoryMomentDisplaySurface
): VictoryMomentCardDisplay {
  const quote = moment.quote?.trim() || null;
  const meaning = (moment.meaning ?? moment.body).trim();

  if (quote && isSelfExplanatoryProofQuote(quote)) {
    const secondary =
      meaning && !proofTextsAreDuplicateForDisplay(quote, meaning) ? meaning : null;
    return {
      primaryText: quote,
      secondaryText: secondary,
      showQuoteMarks: true,
      mutedReceiptText: null,
    };
  }

  const primaryText = primaryMeaningFallback(moment);
  const mutedReceiptText =
    surface === "allProof" && quote
      ? `Your reply: "${quote}"`
      : null;

  return {
    primaryText,
    secondaryText: null,
    showQuoteMarks: false,
    mutedReceiptText,
  };
}

/** Meaning-safe primary line for Pat Read / principles (never contextless verbatim). */
export function victoryMomentProofFeedText(moment: VictoryMomentDisplayInput): string {
  return resolveVictoryMomentCardDisplay(moment, "share").primaryText.trim();
}

export type VictoryProofCardRow = VictoryMomentDisplayInput & {
  id: string;
  categoryLabel: string;
  dateLabel: string;
  groundedInEventTypes: string[];
  primaryText: string;
  secondaryText: string | null;
  showQuoteMarks: boolean;
  mutedReceiptText: string | null;
};

export function mapVictoryMomentToProofCardRow(args: {
  moment: VictoryMomentDisplayInput & { id: string; groundedInEventTypes: string[] };
  surface: "home" | "allProof";
  dateLabel: string;
  categoryLabel: string;
}): VictoryProofCardRow {
  const { moment, surface, dateLabel, categoryLabel } = args;
  const display = resolveVictoryMomentCardDisplay(moment, surface);
  return {
    id: moment.id,
    categoryLabel,
    headline: moment.headline,
    body: moment.body,
    quote: moment.quote,
    meaning: moment.meaning,
    dateLabel,
    groundedInEventTypes: moment.groundedInEventTypes,
    primaryText: display.primaryText,
    secondaryText: display.secondaryText,
    showQuoteMarks: display.showQuoteMarks,
    mutedReceiptText: display.mutedReceiptText,
  };
}

export { isSelfExplanatoryProofQuote } from "@/lib/v2-victory-proof-quote";

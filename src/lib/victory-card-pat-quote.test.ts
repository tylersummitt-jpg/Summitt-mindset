import { describe, expect, it } from "vitest";

import {
  getVictoryCardPatQuote,
  VICTORY_CARD_PAT_QUOTE_FALLBACK,
  VICTORY_CARD_PAT_QUOTES,
} from "@/lib/victory-card-pat-quote";

describe("getVictoryCardPatQuote", () => {
  it("maps each proof category label to the configured Pat quote", () => {
    expect(getVictoryCardPatQuote("Kept the goal")).toBe(VICTORY_CARD_PAT_QUOTES.kept_the_goal);
    expect(getVictoryCardPatQuote("Kept the Thread Alive")).toBe(VICTORY_CARD_PAT_QUOTES.kept_the_goal);
    expect(getVictoryCardPatQuote("Told the truth")).toBe(VICTORY_CARD_PAT_QUOTES.told_the_truth);
    expect(getVictoryCardPatQuote("Got back on track")).toBe(VICTORY_CARD_PAT_QUOTES.got_back_on_track);
    expect(getVictoryCardPatQuote("Adjusted wisely")).toBe(VICTORY_CARD_PAT_QUOTES.adjusted_wisely);
    expect(getVictoryCardPatQuote("Raised the bar")).toBe(VICTORY_CARD_PAT_QUOTES.raised_the_bar);
    expect(getVictoryCardPatQuote("Completed a season")).toBe(VICTORY_CARD_PAT_QUOTES.completed_season);
    expect(getVictoryCardPatQuote("Named the next goal")).toBe(VICTORY_CARD_PAT_QUOTES.raised_the_bar);
  });

  it("defaults unknown labels to kept_the_goal tone (same as share tones)", () => {
    expect(getVictoryCardPatQuote("Some unknown label")).toBe(VICTORY_CARD_PAT_QUOTES.kept_the_goal);
  });

  it("exposes a fallback quote for missing map entries", () => {
    expect(VICTORY_CARD_PAT_QUOTE_FALLBACK).toBe("Do not compromise your principles.");
  });
});

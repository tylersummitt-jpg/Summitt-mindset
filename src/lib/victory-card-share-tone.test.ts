import { describe, expect, it } from "vitest";

import {
  getVictoryCardShareTone,
  isExportSafeBoxShadow,
  isExportSafeCssColor,
  listVictoryCardShareToneColorValues,
  VICTORY_CARD_SHARE_TEXT,
} from "@/lib/victory-card-share-tone";

const CATEGORY_SAMPLES = [
  "Kept the goal",
  "Told the truth",
  "Got back on track",
  "Adjusted wisely",
  "Raised the bar",
  "Completed a season",
] as const;

describe("victory-card-share-tone", () => {
  it("returns only hex/rgb/rgba/linear-gradient colors with no oklab/oklch", () => {
    for (const label of CATEGORY_SAMPLES) {
      const tone = getVictoryCardShareTone(label);
      for (const value of listVictoryCardShareToneColorValues(tone)) {
        expect(isExportSafeCssColor(value), `${label}: ${value}`).toBe(true);
        expect(value.toLowerCase()).not.toContain("oklab");
        expect(value.toLowerCase()).not.toContain("oklch");
        expect(value.toLowerCase()).not.toContain("color-mix");
      }
      expect(isExportSafeBoxShadow(tone.cardInnerGlow), `${label} glow`).toBe(true);
    }
  });

  it("maps category labels to distinct tone keys", () => {
    expect(getVictoryCardShareTone("Told the truth").pillText).toBe("#7dd3fc");
    expect(getVictoryCardShareTone("Kept the goal").pillText).toBe("#6ee7b7");
    expect(getVictoryCardShareTone("Raised the bar").pillText).toBe("#fcd34d");
  });

  it("exposes shared brand/tagline text colors as export-safe", () => {
    for (const value of Object.values(VICTORY_CARD_SHARE_TEXT)) {
      expect(isExportSafeCssColor(value)).toBe(true);
    }
  });
});

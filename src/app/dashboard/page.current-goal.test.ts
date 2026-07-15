import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = path.join(process.cwd(), "src/app/dashboard/page.tsx");

describe("dashboard Current goal display", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("uses behavior_statement (normalizedBaseAsk) as Current goal headline, not title", () => {
    expect(src).toContain("Current goal");
    expect(src).toContain("normalizedBaseAsk");
    expect(src).toContain("No current goal set yet.");
    // Current-goal card must not render commitment.title as the headline.
    const cardStart = src.indexOf("Current goal");
    const cardEnd = src.indexOf("No active commitment on file", cardStart);
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    const card = src.slice(cardStart, cardEnd);
    expect(card).not.toContain("commitment.title");
    expect(card).toContain("{normalizedBaseAsk}");
  });

  it("does not duplicate behavior_statement under Coach Pat check-in when bars match", () => {
    const cardStart = src.indexOf("Current goal");
    const cardEnd = src.indexOf("No active commitment on file", cardStart);
    const card = src.slice(cardStart, cardEnd);
    expect(card).not.toContain("Coach Pat is checking in on:");
    expect(card).toContain("showSplitAsk");
    expect(card).toContain("Coach Pat is checking in on today:");
  });
});

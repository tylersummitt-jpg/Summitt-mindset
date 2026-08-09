import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Victory Season detail — Wins-only surface", () => {
  const pageSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/dashboard/victory-room/seasons/[seasonId]/page.tsx"),
    "utf8"
  );

  it("keeps Season header, Add a Win, and Season Wins wiring", () => {
    expect(pageSrc).toContain("VictorySeasonHeader");
    expect(pageSrc).toContain("Add a Win");
    expect(pageSrc).toContain("/dashboard/victory-room/add-win?seasonId=");
    expect(pageSrc).toContain("loadActiveWinsForSeasonCommitment");
    expect(pageSrc).toContain("view.commitmentId");
    expect(pageSrc).toContain("VictorySeasonWinsSection");
    expect(pageSrc).toContain("loadVictorySeasonProofView");
  });

  it("no longer renders Season Summary or Proof from this season", () => {
    expect(pageSrc).not.toContain("VictorySeasonSummaryBlock");
    expect(pageSrc).not.toContain("VictorySeasonProofList");
    expect(pageSrc).not.toContain("VictorySeasonEmptyState");
    expect(pageSrc).not.toContain("VictoryMomentCard");
    expect(pageSrc).not.toContain("showSummary");
    expect(pageSrc).not.toContain("Proof from this season");
    expect(pageSrc).not.toContain("Little was captured");
    expect(pageSrc).not.toContain("Proof is forming");
    expect(pageSrc).not.toContain("enough proof");
    expect(pageSrc).not.toContain("Pattern:");
    expect(pageSrc).not.toContain("Principle lived");
    expect(pageSrc).not.toContain("Told the Truth");
    expect(pageSrc).not.toContain("Kept the Goal");
    expect(pageSrc).not.toContain("openai");
  });

  it("does not trust client commitment_id", () => {
    expect(pageSrc).not.toContain("searchParams");
    expect(pageSrc).not.toMatch(/commitmentId\s*=\s*.*params/);
  });
});

describe("VictorySeasonWinsSection source", () => {
  it("uses VictoryWinCard and omits empty shell", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictorySeasonWinsSection.tsx"),
      "utf8"
    );
    expect(src).toContain("Wins from this season");
    expect(src).toContain("VictoryWinCard");
    expect(src).toContain("wins.length === 0");
    expect(src).toContain("return null");
    expect(src).not.toMatch(/Manual|SMS|source_type|streak|score/);
  });
});

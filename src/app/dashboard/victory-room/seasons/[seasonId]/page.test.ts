import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Victory Season detail Wins + proof separation", () => {
  const pageSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/dashboard/victory-room/seasons/[seasonId]/page.tsx"),
    "utf8"
  );

  it("loads Season Wins from authoritative commitment and renders Wins section", () => {
    expect(pageSrc).toContain("loadActiveWinsForSeasonCommitment");
    expect(pageSrc).toContain("view.commitmentId");
    expect(pageSrc).toContain("VictorySeasonWinsSection");
    expect(pageSrc).toContain("Add a Win");
    expect(pageSrc).toContain("/dashboard/victory-room/add-win?seasonId=");
  });

  it("preserves proof-event path and does not mix sources", () => {
    expect(pageSrc).toContain("loadVictorySeasonProofView");
    expect(pageSrc).toContain("VictorySeasonProofList");
    expect(pageSrc).not.toContain("openai");
    // JSX order: Wins section before proof list
    const winsJsx = pageSrc.indexOf("<VictorySeasonWinsSection");
    const proofJsx = pageSrc.indexOf("<VictorySeasonProofList");
    expect(winsJsx).toBeGreaterThan(-1);
    expect(proofJsx).toBeGreaterThan(winsJsx);
  });

  it("does not trust client commitment_id or redesign proof semantics", () => {
    expect(pageSrc).not.toContain("searchParams");
    expect(pageSrc).not.toMatch(/commitmentId\s*=\s*.*params/);
    expect(pageSrc).toContain("VictorySeasonEmptyState");
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

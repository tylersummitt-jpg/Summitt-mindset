import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Victory Room main — legacy proof surface retirement", () => {
  const pageSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/dashboard/victory-room/page.tsx"),
    "utf8"
  );

  it("keeps Wins, Seasons, Coach Pat Feedback, and Pat Principles", () => {
    expect(pageSrc).toContain("VictoryRecentProofSection");
    expect(pageSrc).toContain("VictorySeasonsSection");
    expect(pageSrc).toContain("VictoryPatReadSection");
    expect(pageSrc).toContain("VictoryPatPrinciplesSection");
    expect(pageSrc).toContain("VictoryRoomTopCard");
  });

  it("hides Earlier Chapters proof-history link from primary Victory Room", () => {
    expect(pageSrc).not.toContain("VictoryEarlierHistoryLinkSection");
    expect(pageSrc).not.toContain("hasEarlierChapterHistory");
  });
});

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Victory Season detail Add a Win entry", () => {
  it("links Add a Win with owned seasonId query param", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/seasons/[seasonId]/page.tsx"),
      "utf8"
    );
    expect(src).toContain("Add a Win");
    expect(src).toContain("/dashboard/victory-room/add-win?seasonId=");
    expect(src).toContain("view.seasonId");
    expect(src).not.toContain("VictoryWinCard");
    expect(src).not.toContain("openai");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("GuidedResolutionClient copy audit", () => {
  it("includes commitment replace focus strings from legacy screenshot", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/guided-resolution/guided-resolution-client.tsx"),
      "utf8"
    );
    expect(src).toContain("Update your focus");
    expect(src).toContain("You chose NEW on the alignment check");
    expect(src).toContain("One line is enough");
    expect(src).toContain("Accountability focus");
    expect(src).toContain("/api/v2/guided-resolution/commitment");
  });
});


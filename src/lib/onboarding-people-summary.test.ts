import { describe, expect, it } from "vitest";
import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";

describe("buildPeopleSummaryMirror", () => {
  it("omits display names", () => {
    const mirror = buildPeopleSummaryMirror([
      { relationship_type: "spouse_partner" },
      { relationship_type: "child" },
      { relationship_type: "child" },
    ]);
    expect(mirror).toContain("spouse/partner");
    expect(mirror).toContain("2 children");
    expect(mirror).not.toContain("Jim");
  });

  it("returns null for empty", () => {
    expect(buildPeopleSummaryMirror([])).toBeNull();
  });
});

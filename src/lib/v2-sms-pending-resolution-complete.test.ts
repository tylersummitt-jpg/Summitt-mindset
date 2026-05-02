import { afterEach, describe, expect, it } from "vitest";
import { isThinCommitmentBarForVictoryCallout } from "@/lib/v2-human-sms-brain/thin-commitment-bar-for-victory";

describe("isThinCommitmentBarForVictoryCallout", () => {
  it("treats very short multi-word bars as thin", () => {
    expect(isThinCommitmentBarForVictoryCallout("Run daily")).toBe(true);
  });

  it("treats duration-only text as thin", () => {
    expect(isThinCommitmentBarForVictoryCallout("2 hours")).toBe(true);
  });

  it("does not treat substantive bars as thin", () => {
    expect(
      isThinCommitmentBarForVictoryCallout(
        "Work on distribution for two hours with focused outreach"
      )
    ).toBe(false);
  });
});

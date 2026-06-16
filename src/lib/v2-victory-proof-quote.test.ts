import { describe, expect, it } from "vitest";

import { isSelfExplanatoryProofQuote } from "@/lib/v2-victory-proof-quote";

describe("isSelfExplanatoryProofQuote", () => {
  it("treats short acknowledgments as contextless", () => {
    expect(isSelfExplanatoryProofQuote("Good")).toBe(false);
    expect(isSelfExplanatoryProofQuote("OK")).toBe(false);
    expect(isSelfExplanatoryProofQuote("Yes")).toBe(false);
    expect(isSelfExplanatoryProofQuote("Done")).toBe(false);
    expect(isSelfExplanatoryProofQuote("k")).toBe(false);
  });

  it("treats emoji-only as contextless", () => {
    expect(isSelfExplanatoryProofQuote("👍")).toBe(false);
    expect(isSelfExplanatoryProofQuote("🙌 🎉")).toBe(false);
  });

  it("treats substantive accountability replies as self-explanatory", () => {
    expect(isSelfExplanatoryProofQuote("I did not hit my goal yesterday")).toBe(true);
    expect(isSelfExplanatoryProofQuote("Yes! I got it done today!")).toBe(true);
    expect(isSelfExplanatoryProofQuote("Only got 90 minutes, but I stayed with it.")).toBe(true);
    expect(
      isSelfExplanatoryProofQuote("I tightened it: one outreach block before noon.")
    ).toBe(true);
  });
});

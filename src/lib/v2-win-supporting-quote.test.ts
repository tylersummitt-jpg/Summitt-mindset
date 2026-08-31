import { describe, expect, it } from "vitest";
import {
  WIN_SUPPORTING_QUOTE_MAX_CHARS,
  validateWinSupportingQuote,
} from "@/lib/v2-win-supporting-quote";

const INBOUND =
  "Yes! I finally put my phone away and played basketball with the kids for an hour.";

describe("validateWinSupportingQuote", () => {
  it("null / non-string / empty → null", () => {
    expect(validateWinSupportingQuote(null, INBOUND)).toBeNull();
    expect(validateWinSupportingQuote(undefined, INBOUND)).toBeNull();
    expect(validateWinSupportingQuote(12, INBOUND)).toBeNull();
    expect(validateWinSupportingQuote({}, INBOUND)).toBeNull();
    expect(validateWinSupportingQuote("", INBOUND)).toBeNull();
    expect(validateWinSupportingQuote("   ", INBOUND)).toBeNull();
  });

  it("trims outer whitespace and keeps an exact inbound substring", () => {
    expect(
      validateWinSupportingQuote(
        "  I finally put my phone away and played basketball with the kids for an hour.  ",
        INBOUND
      )
    ).toBe("I finally put my phone away and played basketball with the kids for an hour.");
  });

  it("preserves internal whitespace", () => {
    const inbound = "We had  the  best conversation";
    expect(validateWinSupportingQuote("the  best conversation", inbound)).toBe(
      "the  best conversation"
    );
  });

  it("rejects paraphrase and text not in this inbound", () => {
    expect(
      validateWinSupportingQuote("I put the phone down and played with the children.", INBOUND)
    ).toBeNull();
    expect(validateWinSupportingQuote("Coach asked if I worked out", INBOUND)).toBeNull();
  });

  it("rejects >240 without slicing", () => {
    const tooLong = "x".repeat(WIN_SUPPORTING_QUOTE_MAX_CHARS + 1);
    const haystack = `${tooLong} trailing`;
    expect(tooLong.length).toBe(241);
    expect(validateWinSupportingQuote(tooLong, haystack)).toBeNull();
  });

  it("accepts 240 exact substring", () => {
    const exact = "x".repeat(WIN_SUPPORTING_QUOTE_MAX_CHARS);
    expect(validateWinSupportingQuote(exact, exact)).toBe(exact);
  });

  it("rejects control characters including newlines", () => {
    expect(validateWinSupportingQuote("played\nbasketball", "played\nbasketball")).toBeNull();
    expect(validateWinSupportingQuote("played\tbasketball", "played\tbasketball")).toBeNull();
  });

  it("does not case-fold", () => {
    expect(validateWinSupportingQuote("YES!", INBOUND)).toBeNull();
  });

  it("never throws", () => {
    expect(() => validateWinSupportingQuote("ok", INBOUND)).not.toThrow();
    expect(() => validateWinSupportingQuote(null, null as unknown as string)).not.toThrow();
  });
});

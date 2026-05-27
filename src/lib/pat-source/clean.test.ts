import { describe, expect, it } from "vitest";

import {
  cleanParagraphText,
  collapseWhitespace,
  countWords,
  excerptText,
  fixHyphenatedLineBreaks,
  isNoiseParagraph,
  normalizeTypography,
} from "@/lib/pat-source/clean";

describe("pat-source clean", () => {
  it("collapses whitespace and normalizes quotes", () => {
    expect(collapseWhitespace("  hello   world  ")).toBe("hello world");
    expect(normalizeTypography("“Pat said”")).toBe('"Pat said"');
  });

  it("fixes hyphenated line breaks", () => {
    expect(fixHyphenatedLineBreaks("be-\ncome")).toBe("become");
    expect(cleanParagraphText("be-\ncome strong")).toBe("become strong");
  });

  it("rejects noise paragraphs", () => {
    expect(isNoiseParagraph("12")).toBe(true);
    expect(isNoiseParagraph("This is a real paragraph with enough letters.")).toBe(
      false
    );
  });

  it("counts words and excerpts safely", () => {
    expect(countWords("one two three")).toBe(3);
    expect(excerptText("a".repeat(300), 50).length).toBeLessThanOrEqual(50);
  });
});

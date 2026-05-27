import { describe, expect, it } from "vitest";

import { parseHtmlToBlocks } from "@/lib/pat-source/parse-docx";

describe("parseHtmlToBlocks", () => {
  it("parses headings and paragraphs in order", () => {
    const html = `
      <h1>CHAPTER ONE</h1>
      <p>First paragraph about discipline and standards.</p>
      <h2>Section</h2>
      <p>Second paragraph about team responsibility.</p>
    `;
    const blocks = parseHtmlToBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks[0]?.type).toBe("heading");
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("discipline"))).toBe(
      true
    );
  });
});

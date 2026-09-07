import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts");

describe("v2-sms-pending-resolution-complete — proof callout after insert", () => {
  const src = fs.readFileSync(SRC, "utf8");

  it("inserts commitment change proof before appending Victory callout (replace) is leftover-dead", () => {
    const early = src.indexOf("Slice 6: leftover does not own saved-replace English.");
    const replaceApplied = src.indexOf('brainCase: "pending_resolution_replace_applied"');
    expect(early).toBeGreaterThan(0);
    expect(replaceApplied).toBeGreaterThan(early);
    expect(src.indexOf("return { handled: false };", early)).toBeGreaterThan(early);
    expect(src.indexOf("return { handled: false };", early)).toBeLessThan(replaceApplied);
  });

  it("inserts commitment change proof before appending Victory callout (tighten)", () => {
    const tightenBlock = src.slice(
      src.indexOf("const proofTightenInserted = await insertSmsCommitmentChangeProofEvent"),
      src.indexOf("brainCase: \"pending_resolution_tighten_applied\"")
    );
    const insertIdx = tightenBlock.indexOf("insertSmsCommitmentChangeProofEvent");
    const appendIdx = tightenBlock.indexOf("appendSmsParagraphIfUnderCap");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(appendIdx).toBeGreaterThan(insertIdx);
    expect(tightenBlock).toContain("if (proofTightenInserted && vrAppendTight)");
  });
});

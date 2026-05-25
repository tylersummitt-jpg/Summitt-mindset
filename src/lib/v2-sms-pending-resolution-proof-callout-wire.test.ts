import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts");

describe("v2-sms-pending-resolution-complete — proof callout after insert", () => {
  const src = fs.readFileSync(SRC, "utf8");

  it("inserts commitment change proof before appending Victory callout (replace)", () => {
    const replaceBlock = src.slice(
      src.indexOf("const proofInserted = await insertSmsCommitmentChangeProofEvent"),
      src.indexOf("brainCase: \"pending_resolution_replace_applied\"")
    );
    const insertIdx = replaceBlock.indexOf("insertSmsCommitmentChangeProofEvent");
    const appendIdx = replaceBlock.indexOf("appendSmsParagraphIfUnderCap");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(appendIdx).toBeGreaterThan(insertIdx);
    expect(replaceBlock).toContain("if (proofInserted && vrAppend)");
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

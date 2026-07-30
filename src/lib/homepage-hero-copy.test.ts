import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("homepage hero copy hierarchy (source)", () => {
  it("uses the approved headline and subtitle only", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("TAKE PRIDE IN YOUR LIFE.");
    expect(home).toContain("Pat Summitt is your personal coach - every day.");
    expect(home).not.toContain(
      "Choose one clear goal and become the person you have always wanted to be."
    );
  });
});

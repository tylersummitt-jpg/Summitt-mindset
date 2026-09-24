import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("homepage hero copy hierarchy (source)", () => {
  it("uses the approved headline and no hero subtitle", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("Coach Pat in your corner.");
    expect(home).not.toContain("BECOME WHO YOU WANT TO BE.");
    expect(home).not.toContain(
      "Pat Summitt in your corner with personalized accountability texts that turn your goals into daily action."
    );
    expect(home).not.toContain(
      "Choose one clear goal and become the person you have always wanted to be."
    );
  });
});

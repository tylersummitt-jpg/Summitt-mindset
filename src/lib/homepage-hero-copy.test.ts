import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("homepage hero copy hierarchy (source)", () => {
  it("uses the approved headline and supporting line", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("Reach Your Goals.");
    expect(home).toContain("Remember the Journey.");
    expect(home).toContain(
      "Get daily text messages from Coach Pat to help you reach your goals, celebrate your wins, and remember the special moments along the way."
    );
    expect(home).not.toContain("whitespace-nowrap");
    expect(home).not.toContain("Coach Pat in your corner.");
    expect(home).toContain("/brand/ask-pat-coaching.jpg");
    expect(home).not.toContain("home-hero-mobile");
    expect(home).not.toContain("home-hero-desktop");
    expect(home).not.toContain(
      "Setting goals is easy. Following through is the hard part."
    );
    expect(home).not.toContain("BECOME WHO YOU WANT TO BE.");
    expect(home).not.toContain(
      "Pat Summitt in your corner with personalized accountability texts that turn your goals into daily action."
    );
    expect(home).not.toContain(
      "Choose one clear goal and become the person you have always wanted to be."
    );
  });
});

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
    const headline = home.slice(home.indexOf("<h1"), home.indexOf("</h1>"));
    const headlineText = headline.replace(/<[^>]+>/g, "");
    expect(headline).toContain("DAILY COACHING");
    expect(headline).toMatch(/INSPIRED BY\s*<br \/>\s*PAT&nbsp;SUMMITT/);
    expect(headline).toContain("text-white");
    expect(headline).toContain("text-[var(--brand)]");
    expect(headlineText).not.toContain("(");
    expect(headlineText).not.toContain(")");
    expect(home).toContain(
      "Tell Coach Pat what you&apos;re working toward. Get personalized daily text messages that help you turn your goals into daily action and recognize your progress."
    );
    expect(home).toMatch(
      /7 days free · \$0 today\s*<br \/>\s*Then \$29\/month · Cancel anytime/
    );
    expect(home).toContain("Start My Free Trial");
    expect(home).not.toContain("whitespace-nowrap");
    expect(home).not.toContain("Coach Pat in your corner.");
    expect(home).toContain("/brand/pat-summitt-homepage-hero.jpg");
    expect(home).not.toContain("/brand/ask-pat-coaching.jpg");
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

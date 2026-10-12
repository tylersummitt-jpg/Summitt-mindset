import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("homepage entitled member redirect (source)", () => {
  it("uses the shared membership helper and redirects to post-sign-in before marketing work", () => {
    const home = read("src/app/page.tsx");

    expect(home).toContain(
      'from "@/lib/onboarding-subscription-metadata"'
    );
    expect(home).toContain("isSubscribedFromPublicMetadata");
    expect(home).toContain('redirect("/post-sign-in")');
    expect(home).not.toContain('redirect("/dashboard/victory-room")');

    const redirectIndex = home.indexOf('redirect("/post-sign-in")');
    const headlineIndex = home.indexOf("Reach Your Goals.");

    expect(redirectIndex).toBeGreaterThan(-1);
    expect(home).not.toContain("/api/quote-of-the-day");
    expect(headlineIndex).toBeGreaterThan(redirectIndex);
  });

  it("keeps signed-out marketing copy in the homepage source", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("Reach Your Goals.");
    expect(home).toContain("Start My Free Trial");
  });
});

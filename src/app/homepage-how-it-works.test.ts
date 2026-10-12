import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("homepage explainer", () => {
  const page = readSrc("src/app/page.tsx");

  it("keeps the homepage a server component and shows the three steps without the player", () => {
    expect(page).not.toContain('"use client"');
    expect(page).toContain("<HomepageHowItWorksSteps />");
    expect(page).not.toContain("HomepageHowItWorksVideo");
    expect(page).not.toContain("homepage_video");
    expect(page).not.toContain("/api/quote-of-the-day");
    expect(page).not.toContain("Define your identity");
    expect(page).not.toContain("Choose your current goal");
    expect(page).not.toContain("Respond to daily texts from Pat Summitt AI");
    expect(page).not.toContain("Become the person you want to be");
    expect(page).not.toContain("HowItWorksIdentityIcon");
    const steps = readSrc("src/components/homepage-how-it-works-steps.tsx");
    expect(steps).toContain("It's as Easy as Sending a Text.");
    expect(steps).toContain("Tell Coach Pat About Yourself");
    expect(steps).toContain("Get Personal Daily Texts");
    expect(steps).toContain("Celebrate and Remember");
    expect(readSrc("src/lib/homepage-video.ts")).toContain('HOMEPAGE_VIMEO_VIDEO_ID = "1231615684"');
    expect(readSrc("src/components/homepage-how-it-works-video.tsx")).toContain(
      "export function HomepageHowItWorksVideo"
    );
    expect(readSrc("src/app/api/quote-of-the-day/route.ts").length).toBeGreaterThan(0);
  });

  it("does not put the video surface on the homepage", () => {
    expect(page).not.toContain("homepage_video");
    expect(page).not.toContain("data-growth-surface");
  });

  it("does not give the homepage shell a Vimeo SDK auto-embed attribute or a fake play control", () => {
    const player = readSrc("src/components/homepage-how-it-works-video.tsx");
    expect(player).not.toContain("data-vimeo-id");
    expect(player).not.toContain("data-vimeo-url");
    expect(player).not.toContain("<svg");
    expect(player).toContain('import("@vimeo/player")');
    expect(player).toContain("dnt: true");
    expect(player).not.toContain("autoplay");
    expect(readSrc("src/app/film-room/[id]/page.tsx")).not.toContain("@vimeo/player");
    expect(readSrc("src/components/programs/programs-video.tsx")).not.toContain("@vimeo/player");
    expect(readSrc("src/lib/homepage-video.ts")).not.toContain("HOMEPAGE_VIDEO_LAUNCHED_AT");
    expect(readSrc("src/app/admin/subscriber-growth/subscriber-growth-dashboard.tsx")).not.toContain(
      "Homepage before and after the video"
    );
  });

  it("keeps the Vimeo id out of other product surfaces", () => {
    const hits = execSync("rg -l --hidden -g '!node_modules' 1231615684 .", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((line) => line.replace(/^\.\//, ""))
      .sort();
    expect(hits).toEqual([
      "src/app/homepage-how-it-works.test.ts",
      "src/components/homepage-how-it-works-video.test.tsx",
      "src/lib/homepage-video.ts",
    ]);
  });
});

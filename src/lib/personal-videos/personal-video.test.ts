import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { isLandingExperimentEntryPath } from "@/lib/landing-experiment-shared";
import { isMarketingPageViewPath } from "@/lib/marketing-attribution-pure";
import {
  isPersonalVideoByteSize,
  isPersonalVideoToken,
  isVimeoUploadLink,
  newPersonalVideoToken,
  personalVideoCreateBody,
  personalVideoPrivacyOk,
  readinessFromVimeo,
  vimeoIdFromUri,
  watchPathForStatus,
} from "@/lib/personal-videos/personal-video";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("personal video rules", () => {
  it("creates a hidden, domain-limited video and a link only after it is ready", () => {
    const token = newPersonalVideoToken();
    expect(isPersonalVideoToken(token)).toBe(true);
    expect(personalVideoCreateBody(1200).privacy).toEqual({
      view: "disable",
      embed: "whitelist",
      download: false,
    });
    expect(vimeoIdFromUri("/videos/1150754357")).toBe("1150754357");
    expect(isVimeoUploadLink("https://files.tus.vimeo.com/upload")).toBe(true);
    expect(isVimeoUploadLink("http://files.tus.vimeo.com/upload")).toBe(false);
    expect(isPersonalVideoByteSize(0)).toBe(false);
    const ready = {
      status: "available",
      transcode: { status: "complete" },
      privacy: { view: "disable", embed: "whitelist", download: false },
    };
    expect(readinessFromVimeo(ready)).toBe("ready");
    expect(readinessFromVimeo({ ...ready, privacy: { view: "anybody", embed: "public", download: false } })).toBe(
      "failed"
    );
    expect(readinessFromVimeo({ status: "transcoding", transcode: { status: "in_progress" } })).toBe("processing");
    expect(watchPathForStatus(token, "ready")).toBe(`/for/${token}`);
    expect(watchPathForStatus(token, "processing")).toBeNull();
    expect(personalVideoPrivacyOk(ready)).toBe(true);
  });

  it("keeps the viewing page out of the homepage experiment and behind no login", () => {
    const middleware = read("src/middleware.ts");
    const page = read("src/app/for/[token]/page.tsx");
    const studio = read("src/app/admin/personal-videos/page.tsx");
    const client = read("src/app/admin/personal-videos/personal-videos-client.tsx");
    const upload = read("src/lib/personal-videos/vimeo.ts");
    expect(middleware).toContain('"/for/(.*)"');
    expect(isMarketingPageViewPath("/for/abc")).toBe(false);
    expect(isLandingExperimentEntryPath("/for/abc")).toBe(false);
    expect(page).toContain("index: false");
    expect(page).toContain('"/checkout/start"');
    expect(page).toContain("Start My 7-Day Free Trial");
    expect(page).toContain("bg-[var(--brand)]");
    expect(page).toContain("!text-[#111827]");
    expect(page).toContain("rounded-xl");
    expect(page).toContain("hover:opacity-95");
    expect(page).not.toContain("bg-white");
    expect(page).toContain('"/checkout/start?plan=annual"');
    expect(page).toContain("buildVimeoPlayerEmbedUrl");
    expect(page).toContain("A Personal Message From Tyler Summitt");
    const navbar = read("src/components/Navbar.tsx");
    const personalHeader = navbar.slice(navbar.indexOf('pathname?.startsWith("/for/")'));
    expect(personalHeader).toContain("Summitt");
    expect(personalHeader.slice(0, personalHeader.indexOf("const startFreeTrialHref"))).not.toContain("Victory Room");
    expect(navbar).toContain('label: "Victory Room"');
    expect(navbar).toContain('label: "Film Room"');
    expect(studio).toContain("isTylerOwnerSession");
    expect(client).not.toContain("VIMEO_ACCESS_TOKEN");
    expect(upload).toContain("process.env.VIMEO_ACCESS_TOKEN");
    expect(read("src/app/api/admin/personal-videos/route.ts")).toContain(
      "{ id: video.id, uploadLink: created.uploadLink }"
    );
    expect(() => read("src/app/api/admin/vimeo-credential-check/route.ts")).toThrow();
  });
});

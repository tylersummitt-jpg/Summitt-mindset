import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { isLandingExperimentEntryPath } from "@/lib/landing-experiment-shared";
import { isMarketingPageViewPath } from "@/lib/marketing-attribution-pure";
import {
  isPersonalVideoToken,
  isVimeoUploadLink,
  newPersonalVideoToken,
  personalVideoCreateBody,
  personalVideoPosterOk,
  personalVideoPosterSeconds,
  personalVideoPosterStep,
  personalVideoPrivacyOk,
  readinessFromVimeo,
  vimeoIdFromUri,
  watchPathForStatus,
} from "@/lib/personal-videos/personal-video";
import {
  isPersonalVideoByteSize,
  PERSONAL_VIDEO_MAX_BYTES,
  PERSONAL_VIDEO_TOO_LARGE_MESSAGE,
} from "@/lib/personal-videos/upload-limit";

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
    expect(PERSONAL_VIDEO_MAX_BYTES).toBe(320 * 1024 * 1024);
    expect(isPersonalVideoByteSize(PERSONAL_VIDEO_MAX_BYTES)).toBe(true);
    expect(isPersonalVideoByteSize(PERSONAL_VIDEO_MAX_BYTES + 1)).toBe(false);
    expect(PERSONAL_VIDEO_TOO_LARGE_MESSAGE).toBe(
      "This recording is larger than 320 MB. Record a shorter video, then try Save Video again."
    );
    const ready = {
      status: "available",
      transcode: { status: "complete" },
      privacy: { view: "disable", embed: "whitelist", download: false },
      pictures: { type: "custom", active: true },
    };
    expect(personalVideoPosterOk(ready)).toBe(true);
    expect(personalVideoPosterOk({ pictures: { type: "default", active: true } })).toBe(false);
    expect(personalVideoPosterSeconds(174)).toBe(2);
    expect(personalVideoPosterSeconds(1)).toBe(0.5);
    expect(personalVideoPosterSeconds(undefined)).toBe(2);
    expect(personalVideoPosterStep([{ type: "custom", active: true, uri: "/videos/1/pictures/2" }])).toBe("keep");
    expect(personalVideoPosterStep([{ type: "custom", active: false, uri: "/videos/1/pictures/2" }])).toBe(
      "activate"
    );
    expect(personalVideoPosterStep([{ type: "default", active: true }])).toBe("create");
    expect(readinessFromVimeo(ready)).toBe("ready");
    expect(readinessFromVimeo({ ...ready, pictures: { type: "default", active: true } })).toBe("processing");
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
    expect(page).not.toContain("plan=annual");
    expect(page).not.toContain("Or start the annual plan");
    expect(page).toContain("MEMBERSHIP_PUBLIC_OFFER.annual");
    expect(page).toContain("buildVimeoPlayerEmbedUrl");
    expect(page).toContain("A Personal Message From Tyler Summitt");
    const navbar = read("src/components/Navbar.tsx");
    const personalHeader = navbar.slice(navbar.indexOf('pathname?.startsWith("/for/")'));
    expect(personalHeader).toContain("Summitt");
    const personalHeaderOnly = personalHeader.slice(0, personalHeader.indexOf("const startFreeTrialHref"));
    expect(personalHeaderOnly).toContain("w-full max-w-6xl");
    expect(personalHeaderOnly).toContain("Learn More →");
    expect(personalHeaderOnly).toContain('href="/"');
    expect(personalHeaderOnly).not.toContain("Victory Room");
    expect(personalHeaderOnly).not.toContain("Ask Pat");
    expect(personalHeaderOnly).not.toContain("Film Room");
    expect(personalHeaderOnly).not.toContain("Programs");
    expect(navbar).toContain('label: "Victory Room"');
    expect(navbar).toContain('label: "Film Room"');
    expect(studio).toContain("isTylerOwnerSession");
    expect(client).not.toContain("VIMEO_ACCESS_TOKEN");
    expect(client).toContain("Mark as sent");
    expect(client).toContain('from "@/lib/personal-videos/upload-limit"');
    expect(client).toContain("PERSONAL_VIDEO_TOO_LARGE_MESSAGE");
    expect(client).toContain('body?.error === "invalid_video"');
    expect(read("src/app/api/admin/personal-videos/route.ts")).toContain(
      'from "@/lib/personal-videos/upload-limit"'
    );
    expect(read("src/lib/personal-videos/personal-video.ts")).toContain(
      'from "@/lib/personal-videos/upload-limit"'
    );
    const repair = upload.slice(
      upload.indexOf("export async function repairPersonalVideoPoster"),
      upload.indexOf("export async function repairReadyPersonalVideoPosters")
    );
    expect(repair).toContain("/videos/${vimeoId}/pictures");
    expect(repair).toContain("time: personalVideoPosterSeconds");
    expect(repair).toContain("active: true");
    expect(repair).not.toContain("privacy");
    expect(read("src/app/api/admin/personal-videos/[id]/route.ts")).toContain("repairPersonalVideoPoster");
    expect(read("src/app/admin/personal-videos/page.tsx")).toContain("repairReadyPersonalVideoPosters");
    expect(upload).toContain("process.env.VIMEO_ACCESS_TOKEN");
    expect(read("src/app/api/admin/personal-videos/route.ts")).toContain(
      "{ id: video.id, uploadLink: created.uploadLink }"
    );
    expect(() => read("src/app/api/admin/vimeo-credential-check/route.ts")).toThrow();
  });
});

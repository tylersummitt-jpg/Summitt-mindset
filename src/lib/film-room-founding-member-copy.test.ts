import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const FOUNDING_MEMBER_FILM_ROOM_SENTENCE =
  "The Film Room is included as a bonus for Founding Members.";

describe("Film Room Founding Member bonus sentence (source)", () => {
  it("preview places the exact sentence beneath the Film Room Library heading", () => {
    const preview = read("src/app/film-room-preview/page.tsx");
    expect(preview).not.toContain("Included In Subscription");
    expect(preview).toContain(FOUNDING_MEMBER_FILM_ROOM_SENTENCE);
    expect(preview.indexOf("Film Room Library")).toBeLessThan(
      preview.indexOf(FOUNDING_MEMBER_FILM_ROOM_SENTENCE)
    );
    expect(preview).toContain("marketingAcquisitionHref");
    expect(preview).toContain("marketingTrialCtaLabel");
  });

  it("member library places the exact sentence beneath Optional film study copy", () => {
    const library = read("src/app/film-room/page.tsx");
    expect(library).toContain("Optional film study. Never required.");
    expect(library).toContain(FOUNDING_MEMBER_FILM_ROOM_SENTENCE);
    expect(library.indexOf("Optional film study. Never required.")).toBeLessThan(
      library.indexOf(FOUNDING_MEMBER_FILM_ROOM_SENTENCE)
    );
  });

  it("individual video page does not include the Founding Member bonus sentence", () => {
    const detail = read("src/app/film-room/[id]/page.tsx");
    expect(detail).not.toContain(FOUNDING_MEMBER_FILM_ROOM_SENTENCE);
  });
});

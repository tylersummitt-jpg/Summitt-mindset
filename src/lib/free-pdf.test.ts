import { readFileSync } from "node:fs";
import path from "node:path";
import { createRouteMatcher } from "@clerk/nextjs/server";
import { describe, expect, it } from "vitest";

import { ACQUISITION_ASSET_FILES } from "@/lib/acquisition/assets";
import { GET as getPlaybook } from "@/app/free/basketball-playbook/download/route";
import { GET as getTeamGuide } from "@/app/free/definite-dozen/team/download/route";
import { COACH_SIGN_UP_HREF, COACH_SUBSCRIBE_PATH } from "@/lib/coach-funnel-links";
import {
  BASKETBALL_PLAYBOOK_PAGE,
  DEFINITE_DOZEN_PAGE,
  freePdfCheckoutHref,
  freePdfCoachKitHref,
  freePdfCoachKitPageHref,
  freePdfTrialHref,
} from "@/lib/free-pdf";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function publicRoutes() {
  const middleware = readSrc("src/middleware.ts");
  const match = middleware.match(/createRouteMatcher\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error("Could not find createRouteMatcher([...]) in middleware");
  const patterns = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
  const isPublicRoute = createRouteMatcher(patterns);
  return (pathname: string) =>
    isPublicRoute({ nextUrl: { pathname } } as Parameters<typeof isPublicRoute>[0]);
}

describe("free PDF pages", () => {
  const isPublic = publicRoutes();
  const shapedToken = `camp_1.${"a".repeat(43)}`;

  it("keeps the two pages and their downloads public, and leaves member routes protected", () => {
    expect(isPublic("/free/basketball-playbook")).toBe(true);
    expect(isPublic("/free/basketball-playbook/download")).toBe(true);
    expect(isPublic("/free/definite-dozen")).toBe(true);
    expect(isPublic("/free/definite-dozen/team/download")).toBe(true);
    expect(isPublic("/free/definite-dozen/athletic-director/download")).toBe(false);
    expect(isPublic("/free")).toBe(false);
    expect(isPublic("/dashboard")).toBe(false);
    expect(isPublic("/admin")).toBe(false);
  });

  it("sends the trial through checkout and forwards only a shaped campaign token", () => {
    expect(freePdfTrialHref(undefined)).toBe("/checkout/start");
    expect(freePdfTrialHref("camp_1")).toBe("/checkout/start");
    expect(freePdfTrialHref("not a token")).toBe("/checkout/start");
    expect(freePdfTrialHref(shapedToken)).toBe(
      `/checkout/start?ac=${encodeURIComponent(shapedToken)}`
    );
    expect(freePdfTrialHref(shapedToken)).not.toContain("plan=");
    expect(freePdfTrialHref(shapedToken)).not.toContain("aj=");
    expect(freePdfCheckoutHref("/checkout/start?plan=annual", undefined)).toBe(
      "/checkout/start?plan=annual"
    );
    expect(freePdfCheckoutHref("/checkout/start?plan=annual", "not a token")).toBe(
      "/checkout/start?plan=annual"
    );
    expect(freePdfCheckoutHref("/checkout/start?plan=annual", shapedToken)).toBe(
      `/checkout/start?plan=annual&ac=${encodeURIComponent(shapedToken)}`
    );
    expect(freePdfCheckoutHref("/sign-in", shapedToken)).toBe("/sign-in");
    expect(freePdfCoachKitHref(false, undefined)).toBe(COACH_SIGN_UP_HREF);
    expect(freePdfCoachKitHref(true, "not a token")).toBe(COACH_SUBSCRIBE_PATH);
    expect(freePdfCoachKitHref(true, shapedToken)).toBe(
      `${COACH_SUBSCRIBE_PATH}&ac=${encodeURIComponent(shapedToken)}`
    );
    expect(freePdfCoachKitHref(false, shapedToken)).toBe(
      `/sign-up?redirect_url=${encodeURIComponent(`${COACH_SUBSCRIBE_PATH}&ac=${encodeURIComponent(shapedToken)}`)}`
    );
    expect(freePdfCoachKitPageHref("/coach-leadership-kit", undefined)).toBe("/coach-leadership-kit");
    expect(freePdfCoachKitPageHref("/coach-leadership-kit", shapedToken)).toBe(
      `/coach-leadership-kit?ac=${encodeURIComponent(shapedToken)}`
    );

    const href = readSrc("src/lib/free-pdf.ts");
    expect(href).not.toContain("signAcquisitionCampaignId");
    expect(href).not.toContain("signAcquisitionJourneyId");
  });

  it("points each page at the catalog PDF and does not add a form or a new campaign", () => {
    const basketball = readSrc("src/app/free/basketball-playbook/page.tsx");
    const dozen = readSrc("src/app/free/definite-dozen/page.tsx");
    const content = readSrc("src/lib/free-pdf.ts");
    const view = readSrc("src/components/free-resource-page.tsx");

    expect(BASKETBALL_PLAYBOOK_PAGE.downloads.map((item) => item.asset)).toEqual(["playbook"]);
    expect(DEFINITE_DOZEN_PAGE.downloads.map((item) => item.asset)).toEqual(["definite_dozen"]);
    expect(BASKETBALL_PLAYBOOK_PAGE.downloads[0]?.href).toBe("/free/basketball-playbook/download");
    expect(DEFINITE_DOZEN_PAGE.downloads.map((item) => item.href)).toEqual([
      "/free/definite-dozen/team/download",
    ]);
    expect(content + dozen + view).not.toMatch(/definite_dozen_ad|athletic-director\/download|Athletic Director Discussion Guide/i);
    expect(basketball).toContain("CoachLeadershipKitMarketing");
    expect(basketball).toContain("freePdfCoachKitHref");
    expect(basketball).toContain("Free Pat Summitt Playbook");
    expect(dozen).toContain("HomepageMarketing");
    expect(dozen).toContain("freePdfCheckoutHref");
    expect(dozen).toContain("Free Definite Dozen Discussion Guide");
    expect(dozen).not.toContain("CoachLeadershipKitMarketing");
    expect(view).toContain("Download Free PDF");
    expect(view).toContain("A gift from Summitt Mindset");
    expect(view).toContain("Yours to keep. No signup required.");
    expect(view).toContain("Want to take it a step further?");
    expect(view).not.toContain("FREE RESOURCE");
    expect(view).not.toContain("payment card");
    expect(view).not.toMatch(/<form/);
    expect(view + basketball + dozen).not.toMatch(/instantly|create-checkout-session|signAcquisition/i);
  });

  it("traces each download route to its own catalog file", () => {
    const config = readSrc("next.config.ts");
    expect(config).toContain('"/free/basketball-playbook/download"');
    expect(config).toContain('"/free/definite-dozen/team/download"');
    expect(config).not.toContain('"/free/definite-dozen/athletic-director/download"');
    expect(config).toContain(`./${ACQUISITION_ASSET_FILES.playbook.relativePath}`);
    expect(config).toContain(`./${ACQUISITION_ASSET_FILES.definite_dozen.relativePath}`);
    expect(config).toContain(`./${ACQUISITION_ASSET_FILES.definite_dozen_ad.relativePath}`);
  });

  it("serves the exact catalog PDF bytes for each download", async () => {
    const cases = [
      { get: getPlaybook, asset: "playbook" as const },
      { get: getTeamGuide, asset: "definite_dozen" as const },
    ];

    for (const item of cases) {
      const file = ACQUISITION_ASSET_FILES[item.asset];
      const expected = readFileSync(path.join(root, file.relativePath));
      const response = await item.get();
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="${file.filename}"`
      );
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      expect(body.equals(expected)).toBe(true);
    }
  });
});

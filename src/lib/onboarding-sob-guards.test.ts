import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const SOB_ONBOARDING_PATHS = [
  "/onboarding",
  "/onboarding/identity",
  "/onboarding/commitment",
  "/onboarding/review",
  "/onboarding/sms",
  "/onboarding/complete",
] as const;

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

const CANONICAL_PAGE_FILES: Record<(typeof SOB_ONBOARDING_PATHS)[number], string> = {
  "/onboarding": "src/app/onboarding/page.tsx",
  "/onboarding/identity": "src/app/onboarding/identity/page.tsx",
  "/onboarding/commitment": "src/app/onboarding/commitment/page.tsx",
  "/onboarding/review": "src/app/onboarding/review/page.tsx",
  "/onboarding/sms": "src/app/onboarding/sms/page.tsx",
  "/onboarding/complete": "src/app/onboarding/complete/page.tsx",
};

describe("SoB onboarding guards", () => {
  it("gates module has no needs_why or life_desires checks", () => {
    const src = readSrc("src/lib/onboarding-sob-gates.ts");
    expect(src).not.toMatch(/\|\s*"needs_why"/);
    expect(src).not.toMatch(/\.from\(["']life_desires/);
    expect(src).not.toContain("needs_cutover");
    expect(src).toContain("review_acknowledged_at");
    expect(src).toContain("resolveOnboardingSobRedirect");
    expect(src).toContain("getOnboardingSobStatus");
    expect(src).toContain("MEMBER_APP_HOME_PATH");
    expect(src).toContain('from "@/lib/member-app-home-path"');
    expect(src).toContain("export { MEMBER_APP_HOME_PATH }");
    expect(src).not.toMatch(/export const MEMBER_APP_HOME_PATH\s*=/);
  });

  it("member-app-home-path owns Victory Room route constant (client-safe)", () => {
    const home = readSrc("src/lib/member-app-home-path.ts");
    expect(home).toContain('MEMBER_APP_HOME_PATH = "/dashboard/victory-room"');
    expect(home).not.toContain("server-only");
    expect(home).not.toContain("supabase-server");
  });

  it("page guard uses centralized resolver", () => {
    const src = readSrc("src/lib/onboarding-sob-page-guard.ts");
    expect(src).toContain("resolveOnboardingSobRedirect");
  });

  it("all six canonical onboarding pages call requireOnboardingSobPath", () => {
    for (const path of SOB_ONBOARDING_PATHS) {
      const file = CANONICAL_PAGE_FILES[path];
      const src = readSrc(file);
      expect(src, `${path} should use requireOnboardingSobPath`).toContain(
        "requireOnboardingSobPath"
      );
    }
  });

  it("post-sign-in, dashboard, and peripheral layouts use centralized incomplete routing", () => {
    const postSignIn = readSrc("src/app/post-sign-in/page.tsx");
    expect(postSignIn).toContain("getOnboardingSobStatus");
    expect(postSignIn).toContain("MEMBER_APP_HOME_PATH");
    expect(postSignIn).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(postSignIn).not.toMatch(/redirect\("\/dashboard"\)/);
    expect(postSignIn).not.toContain('redirect("/onboarding")');

    const dashboardLayout = readSrc("src/app/dashboard/layout.tsx");
    expect(dashboardLayout).toContain("getOnboardingSobStatus");
    expect(dashboardLayout).not.toContain('redirect("/onboarding")');

    for (const rel of [
      "src/app/coach/complete/layout.tsx",
      "src/app/coach/setup/layout.tsx",
      "src/app/guide/layout.tsx",
      "src/app/dashboard/day/[day]/layout.tsx",
    ]) {
      const src = readSrc(rel);
      expect(src, rel).toContain("redirectIfOnboardingIncomplete");
      expect(src, rel).not.toContain('redirect("/onboarding")');
    }
  });

  it("no /api/onboarding/why route exists", () => {
    expect(existsSync(join(ROOT, "src/app/api/onboarding/why"))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/api/onboarding/why/route.ts"))).toBe(false);
  });

  it("identity API does not write life_desires and clears review ack after save", () => {
    const src = readSrc("src/app/api/onboarding/identity/route.ts");
    expect(src).not.toContain("life_desires");
    expect(src).toContain("clearProposedCommitmentReviewAcknowledgment");
  });

  it("identity page loads draft data for resume", () => {
    const page = readSrc("src/app/onboarding/identity/page.tsx");
    expect(page).toContain("loadIdentityOnboardingDraft");
    expect(page).toContain("initialImportantPeople");
    expect(page).not.toContain("people_summary");
  });

  it("SMS API requires review_acknowledged_at for proposed-only incomplete users", () => {
    const src = readSrc("src/app/api/onboarding/sms/route.ts");
    expect(src).toContain("review_acknowledged_at");
    expect(src).toContain(
      "Please review your Identity and Current Goal before connecting SMS."
    );
    expect(src).not.toMatch(/\|\s*"needs_why"/);
    expect(src).not.toMatch(/\.from\(["']life_desires/);
  });

  it("legacy relationships API is not writable (410 Gone)", () => {
    const src = readSrc("src/app/api/onboarding/relationships/route.ts");
    expect(src).toContain("410");
    expect(src).toContain("retired");
    expect(src).not.toContain("people_summary");
    expect(src).not.toContain("supabaseServer");
  });

  it("review acknowledgment migration exists", () => {
    const sql = readSrc(
      "supabase/migrations/20260602120000_sob_review_acknowledgement.sql"
    );
    expect(sql).toContain("review_acknowledged_at TIMESTAMPTZ NULL");
    expect(sql).not.toMatch(/life_desires/i);
  });

  it("legacy onboarding pages redirect without collecting data", () => {
    const relationships = readSrc("src/app/onboarding/relationships/page.tsx");
    expect(relationships).toContain('redirect("/onboarding/identity")');
    expect(relationships).not.toContain("life_desires");
    expect(relationships).not.toMatch(/<form/i);

    const pressure = readSrc("src/app/onboarding/pressure/page.tsx");
    expect(pressure).toContain('redirect("/onboarding/commitment")');
    expect(pressure).not.toContain("life_desires");

    const why = readSrc("src/app/onboarding/why/page.tsx");
    expect(why).toContain('redirect("/onboarding/identity")');
    expect(why).not.toMatch(/My Why/i);
    expect(why).not.toContain("life_desires");
  });
});

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("paused membership UX wiring (source)", () => {
  it("account shows Resume and hides manage/cancel while paused", () => {
    const page = read("src/app/user/[[...user]]/page.tsx");
    expect(page).toContain("ResumeMembershipButton");
    expect(page).toContain(
      "Your membership is paused. Resume to continue on your existing plan."
    );
    expect(page).toContain("!isPaused ? (");
    expect(page).toContain("ManageMembershipButton");
  });

  it("subscribe shows resume panel for paused and Phase 2 public prices", () => {
    const panel = read("src/app/subscribe/subscribe-checkout-panel.tsx");
    expect(panel).toContain("showPausedResume");
    expect(panel).toContain("Your membership is paused.");
    expect(panel).toContain("Resume your existing membership to continue on the same plan.");
    expect(panel).toContain('body?.error === "membership_paused"');
    expect(panel).toContain("$29");
    expect(panel).toContain("$249");
    expect(panel).toContain("Save $99 · about 28% vs monthly");
    expect(panel).toContain(">Monthly</p>");
    expect(panel).toContain(">Annual</p>");
    expect(panel).not.toContain("$19.99");
    expect(panel).not.toContain("$120");
    expect(panel).not.toContain("Founding Member");
    expect(panel).not.toContain("Lowest price locked in");
    expect(panel).not.toContain("Save 50%");
  });

  it("post-sign-in routes paused users to Account", () => {
    const page = read("src/app/post-sign-in/page.tsx");
    expect(page).toContain('effectiveMd?.summittPlan === "paused"');
    expect(page).toContain('redirect("/user")');
  });

  it("navbar hides Subscribe for paused users", () => {
    const nav = read("src/components/Navbar.tsx");
    expect(nav).toContain("const isPaused = plan === \"paused\"");
    expect(nav).toContain("!isSubscribed && !isPaused");
  });

  it("home page shows Phase 2 monthly pricing copy", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("Then $29 a month • Cancel anytime");
    expect(home).not.toContain("$19.99");
  });
});

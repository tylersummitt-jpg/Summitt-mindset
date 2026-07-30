import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const FOUNDING_MEMBER_BONUS_HEADING = "Founding Member Bonus";
const FOUNDING_MEMBER_BONUS_BODY =
  "All video content from four Pat Summitt leadership programs—previously sold separately for over $1,000—is included at no additional cost.";

describe("paused membership UX wiring (source)", () => {
  it("account shows Resume and hides manage/cancel while paused", () => {
    const page = read("src/app/user/[[...user]]/user-account-client.tsx");
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
    expect(panel).toContain(">Founding Member Monthly</p>");
    expect(panel).toContain(">Founding Member Annual</p>");
    expect(panel).not.toContain(">Monthly</p>");
    expect(panel).not.toContain(">Annual</p>");
    expect(panel).not.toContain(FOUNDING_MEMBER_BONUS_HEADING);
    expect(panel).not.toContain(FOUNDING_MEMBER_BONUS_BODY);
    expect(panel).not.toContain("$19.99");
    expect(panel).not.toContain("$120");
    expect(panel).not.toContain("Lowest price locked in");
    expect(panel).not.toContain("Save 50%");

    const pausedBranchStart = panel.indexOf("if (showPausedResume)");
    const pricingReturnStart = panel.indexOf(
      'return (\n    <div className="w-full max-w-lg mx-auto md:mx-0">'
    );
    expect(pausedBranchStart).toBeGreaterThan(-1);
    expect(pricingReturnStart).toBeGreaterThan(pausedBranchStart);
    const pausedBranch = panel.slice(pausedBranchStart, pricingReturnStart);
    expect(pausedBranch).toContain("Your membership is paused.");
    expect(pausedBranch).toContain("ResumeMembershipButton");
    expect(pausedBranch).not.toContain(FOUNDING_MEMBER_BONUS_HEADING);
    expect(pausedBranch).not.toContain(FOUNDING_MEMBER_BONUS_BODY);
  });

  it("subscribe page places Founding Member Bonus below the hero section", () => {
    const page = read("src/app/subscribe/page.tsx");
    expect(page).toContain(FOUNDING_MEMBER_BONUS_HEADING);
    expect(page).toContain(FOUNDING_MEMBER_BONUS_BODY);
    expect(page).toContain('bg-[var(--brand)]');

    const heroClose = page.indexOf("</section>");
    const bonusHeading = page.indexOf(FOUNDING_MEMBER_BONUS_HEADING);
    const finePrint = page.indexOf("You won&apos;t be charged today");
    expect(heroClose).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(heroClose);
    expect(finePrint).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(finePrint);
    expect(page).toContain("<SubscribeCheckoutPanel />");
    expect(page.indexOf("<SubscribeCheckoutPanel />")).toBeLessThan(bonusHeading);
  });

  it("post-sign-in routes paused users to Account", () => {
    const page = read("src/app/post-sign-in/page.tsx");
    expect(page).toContain('effectiveMd?.summittPlan === "paused"');
    expect(page).toContain('redirect("/user")');
  });

  it("navbar hides Subscribe for paused users", () => {
    const nav = read("src/components/Navbar.tsx");
    expect(nav).toContain("const isPaused = plan === \"paused\"");
    expect(nav).toContain("!isNativeApp && !isSubscribed && !isPaused");
  });

  it("home page shows Phase 2 monthly pricing copy", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain("Then $29 a month • Cancel anytime");
    expect(home).not.toContain("$19.99");
  });
});

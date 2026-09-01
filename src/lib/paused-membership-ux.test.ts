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
    expect(panel).toContain("$29/month");
    expect(panel).toContain("$249/year");
    expect(panel).toContain("Save $99 vs monthly");
    expect(panel).toContain("Start My Free Trial");
    expect(panel).toContain("7-day free trial");
    expect(panel).toContain("You won&apos;t be charged today");
    expect(panel).toContain("Cancel anytime");
    expect(panel).toContain("Kathy P., Oregon");
    expect(panel).toContain('data-subscribe-offer="monthly-primary"');
    expect(panel).toContain('data-subscribe-offer="annual-secondary"');
    expect(panel).not.toContain(FOUNDING_MEMBER_BONUS_HEADING);
    expect(panel).not.toContain(FOUNDING_MEMBER_BONUS_BODY);
    expect(panel).not.toContain("$19.99");
    expect(panel).not.toContain("$120");
    expect(panel).not.toContain("Lowest price locked in");
    expect(panel).not.toContain("Save 50%");
    expect(panel).not.toContain("$0 due today");

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

  it("subscribe checkout is monthly-primary with annual secondary and Kathy below the close", () => {
    const panel = read("src/app/subscribe/subscribe-checkout-panel.tsx");
    const monthlyOffer = panel.indexOf('data-subscribe-offer="monthly-primary"');
    const monthlyCta = panel.indexOf("Start My Free Trial");
    const stripeReassurance = panel.indexOf(
      "You&apos;ll continue to Stripe to add a payment method"
    );
    const annualOffer = panel.indexOf('data-subscribe-offer="annual-secondary"');
    const kathy = panel.indexOf("Kathy P., Oregon");
    const coachSteps = panel.indexOf('aria-label="Coach subscribe steps"');
    expect(monthlyOffer).toBeGreaterThan(-1);
    expect(monthlyCta).toBeGreaterThan(monthlyOffer);
    expect(stripeReassurance).toBeGreaterThan(monthlyCta);
    expect(annualOffer).toBeGreaterThan(stripeReassurance);
    expect(kathy).toBeGreaterThan(annualOffer);
    expect(coachSteps).toBeGreaterThan(-1);
    expect(panel.slice(coachSteps, monthlyOffer)).not.toContain("STEP 2 OF 2");
    expect(panel).toContain('handleCheckout("monthly")');
    expect(panel).toContain('handleCheckout("annual")');
    expect(panel).toContain('fetch("/api/stripe/create-checkout-session"');
  });

  it("unsigned consumer subscribe goes to sign-up; coach keeps src=coach sign-up", () => {
    const panel = read("src/app/subscribe/subscribe-checkout-panel.tsx");
    expect(panel).toContain(
      "`/sign-up?redirect_url=${encodeURIComponent(subscribeReturnPath)}`"
    );
    expect(panel).not.toContain("`/sign-in?redirect_url=${encodeURIComponent(subscribeReturnPath)}`");
    expect(panel).toContain('subscribeReturnPath = isCoachExperience');
    expect(panel).toContain('? "/subscribe?src=coach"');
    expect(panel).toContain(': "/subscribe"');
    expect(panel).toContain("trackCoachInitiateCheckout");
  });

  it("subscribe page places Founding Member Bonus below the hero section", () => {
    const page = read("src/app/subscribe/page.tsx");
    expect(page).toContain(FOUNDING_MEMBER_BONUS_HEADING);
    expect(page).toContain(FOUNDING_MEMBER_BONUS_BODY);
    expect(page).toContain('bg-[var(--brand)]');
    expect(page).toContain("STEP 2 OF 2");
    expect(page).toContain("Start your 7-day free trial");
    expect(page).toContain("Then $29/month");
    expect(page).toContain("You won&apos;t be charged today · Cancel anytime");
    expect(page).toContain("redirect(APP_MEMBERSHIP_PATH)");
    expect(page).not.toContain("$0 due today");

    const heroClose = page.indexOf("</section>");
    const bonusHeading = page.indexOf(FOUNDING_MEMBER_BONUS_HEADING);
    const finePrint = page.indexOf("You won&apos;t be charged today");
    const consumerStep = page.indexOf("STEP 2 OF 2");
    const coachEmptyLeft = page.indexOf("coachSubscribeHero");
    expect(heroClose).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(heroClose);
    expect(finePrint).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(finePrint);
    expect(page).toContain("<SubscribeCheckoutPanel />");
    expect(page.indexOf("<SubscribeCheckoutPanel />")).toBeLessThan(bonusHeading);
    expect(coachEmptyLeft).toBeGreaterThan(-1);
    expect(consumerStep).toBeGreaterThan(page.indexOf("{coachSubscribeHero ? ("));
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

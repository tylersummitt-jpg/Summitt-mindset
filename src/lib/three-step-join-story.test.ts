import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OnboardingProgress from "@/components/onboarding-progress";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const SMS_LEGAL_CONSENT = `By checking this box, I agree to receive recurring membership SMS
              messages from Summitt Mindset, LLC related to my training, including
              daily practice reminders and coaching prompts. Message frequency
              varies. Msg &amp; data rates may apply. Reply STOP to opt out at any
              time. Reply HELP for help. Consent is not a condition of purchase.
              Summitt Mindset does not send marketing or promotional SMS messages
              and does not share mobile opt-in data with third parties for
              marketing purposes.`;

describe("3-step join story copy alignment", () => {
  it("consumer signup is STEP 1 OF 3 with two plan cards", () => {
    const src = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    const consumerGrid = src.indexOf("lg:grid-cols-2");
    const consumerSignUpSlot = src.indexOf("{signUp}", consumerGrid);
    const consumerCopy = src.slice(consumerGrid, consumerSignUpSlot);
    const hopStart = consumerCopy.indexOf("Choose your plan");
    const hopEnd = consumerCopy.indexOf(") : isAcquisitionSignUp ?");
    const checkoutHopCopy = consumerCopy.slice(hopStart, hopEnd);

    expect(consumerCopy).toContain("STEP 1 OF 3");
    expect(consumerCopy).toContain("$0 DUE TODAY");
    expect(consumerCopy).toContain("Choose your plan");
    expect(checkoutHopCopy).toContain("Monthly");
    expect(checkoutHopCopy).toContain("Annual — Save $99");
    expect(checkoutHopCopy).toContain("7 days free");
    expect(checkoutHopCopy).toContain("then $29/month");
    expect(checkoutHopCopy).toContain("then $249/year");
    expect(checkoutHopCopy).toContain("Founding Member Bonus:");
    expect(checkoutHopCopy).toContain(
      "$1,000+ in Pat Summitt leadership videos included at no additional cost"
    );
    expect(checkoutHopCopy.indexOf("then $249/year")).toBeLessThan(
      checkoutHopCopy.indexOf("Founding Member Bonus:")
    );
    expect(checkoutHopCopy).not.toContain("Create your account");
    expect(consumerCopy).not.toContain("Start your 7-day free trial");
    expect(consumerCopy).not.toContain("7 days free · then $29/month");
    expect(consumerCopy).not.toContain("7 days free · then $249/year");
    expect(consumerCopy).not.toContain("Next, you&apos;ll securely start your free trial.");
    expect(consumerCopy).not.toContain("After that, you&apos;ll set up Coach Pat.");
    expect(consumerCopy).not.toContain("$19.99");
    expect(consumerCopy).not.toContain("$120");
    expect(consumerCopy).not.toContain("STEP 1 OF 2");
    expect(consumerCopy).not.toContain("Identity");
    expect(consumerCopy).not.toContain("onboarding");
  });

  it("coach signup does not receive consumer 3-step copy", () => {
    const src = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    const coachOlStart = src.indexOf('aria-label="Coach signup steps"');
    const coachSignUpSlot = src.indexOf("{signUp}", coachOlStart);
    const coachCopy = src.slice(coachOlStart, coachSignUpSlot);

    expect(coachCopy).toContain("Complete onboarding");
    expect(coachCopy).toContain("Leadership Kit");
    expect(coachCopy).not.toContain("STEP 1 OF 3");
    expect(coachCopy).not.toContain("STEP 1 OF 2");
    expect(coachCopy).not.toContain("set up Coach Pat");
    expect(coachCopy).not.toContain("Annual — Save $99");
    expect(coachCopy).not.toContain("$249");
    expect(coachCopy).not.toContain("$29/month");
    expect(coachCopy).not.toContain("Choose your plan");
    expect(coachCopy).not.toContain("FOUNDING MEMBER BONUS");
    expect(coachCopy).not.toContain("Founding Member Bonus:");
    expect(coachCopy).not.toContain(
      "Pat Summitt leadership videos included at no additional cost"
    );
  });

  it("consumer signup appends Founding Member Bonus after Clerk; coach branch does not include it", () => {
    const src = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    const shellClose = src.indexOf("</AuthMarketingShell>");
    const bonusHeading = src.indexOf("FOUNDING MEMBER BONUS");
    const bonusHeadline = src.indexOf(
      "$1,000+ in Pat Summitt leadership programs — included with your membership"
    );
    const bonusBody = src.indexOf(
      "All video content from four Pat Summitt leadership programs, previously sold for over $1,000, is included at no additional cost."
    );
    const consumerSignUpSlot = src.lastIndexOf("{signUp}");
    const coachGate = src.indexOf("{!isCoachSignUp ? (", shellClose - 80);

    expect(shellClose).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(shellClose);
    expect(bonusHeadline).toBeGreaterThan(bonusHeading);
    expect(bonusBody).toBeGreaterThan(bonusHeadline);
    expect(consumerSignUpSlot).toBeGreaterThan(-1);
    expect(bonusHeading).toBeGreaterThan(consumerSignUpSlot);
    expect(src.slice(shellClose, bonusHeading)).toContain("{!isCoachSignUp ? (");
    expect(src.slice(shellClose, bonusHeading)).toContain(
      'className="w-full bg-[var(--brand)]"'
    );
    expect(coachGate).toBeGreaterThan(shellClose);
    expect(coachGate).toBeLessThan(bonusHeading);
  });

  it("checkout-start happy path is STEP 2 OF 3", () => {
    const src = readSrc("src/app/checkout/start/checkout-start-client.tsx");
    expect(src).toContain("STEP 2 OF 3");
    expect(src).toContain("Start your free trial");
    expect(src).toContain("Opening secure checkout…");
    expect(src).toContain("After checkout, you&apos;ll set up Coach Pat.");
    expect(src).not.toContain("STEP 2 OF 2");
    expect(src).toContain("Checkout didn’t start");
    expect(src).toContain("Try again");
    expect(src).toContain("$249/year after your 7-day free trial.");
    expect(src).not.toContain("$19.99");
    expect(src).not.toContain("$120");
  });

  it("consumer subscribe is STEP 2 OF 3 and coach left column stays empty of that copy", () => {
    const page = readSrc("src/app/subscribe/page.tsx");
    const consumerStart = page.indexOf("{coachSubscribeHero ? (");
    const consumerCopy = page.slice(consumerStart, page.indexOf("<SubscribeCheckoutPanel"));

    expect(consumerCopy).toContain("STEP 2 OF 3");
    expect(consumerCopy).toContain("Start your free trial");
    expect(consumerCopy).toContain(
      "$0 due today. After checkout, you&apos;ll set up Coach Pat."
    );
    expect(page).not.toContain("STEP 2 OF 2");

    const panel = readSrc("src/app/subscribe/subscribe-checkout-panel.tsx");
    const coachSteps = panel.indexOf('aria-label="Coach subscribe steps"');
    const monthlyOffer = panel.indexOf('data-subscribe-offer="monthly-primary"');
    expect(panel.slice(coachSteps, monthlyOffer)).not.toContain("STEP 2 OF 3");
    expect(panel.slice(coachSteps, monthlyOffer)).toContain("Start your membership");
  });

  it("Stripe consumer monthly and annual custom_text mention Coach Pat; coach does not get them", () => {
    const src = readSrc("src/app/api/stripe/create-checkout-session/route.ts");
    expect(src).toContain(
      "**$0 due today.** 7 days free, then $29/month. Cancel anytime. After checkout, you'll set up Coach Pat."
    );
    expect(src).toContain(
      "**$0 due today.** 7 days free, then $249/year. Cancel anytime. After checkout, you'll set up Coach Pat."
    );
    expect(src).toContain('if (channel === "web")');
    expect(src).toContain('if (plan === "monthly")');
    expect(src).toContain('} else if (plan === "annual")');
    expect(src).toContain("trial_period_days: 7");
    expect(src).toContain("resolveStripeCheckoutReturnOrigin");
    expect(src).toContain("success_url: `${appUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`");
  });

  it("success recovery CTAs say Set Up Coach Pat for signed-in completion and Sign In for unsigned recovery", () => {
    const src = readSrc("src/app/subscribe/success/page.tsx");
    expect(src).toContain("Starting your free trial…");
    expect(src).toContain("Still starting your trial");
    expect(src).toContain("Your trial is started. Next: set up Coach Pat.");
    expect(src).toContain("Set Up Coach Pat →");
    expect(src).toContain("Sign In to Finish Setup");
    expect(src).toContain("signInUrlPreservingInternalRedirect");
    expect(src).not.toContain("Continue to account");
    expect(src).not.toContain(">Continue →<");
    expect(src).toContain('router.push("/post-sign-in")');
    expect(src).toContain("/api/stripe/confirm-checkout");
    expect(src).toContain("await user.reload()");
    expect(src).not.toMatch(
      /if \(isLoaded && !isSignedIn\) \{\s*[\s\S]*router\.push\(/
    );
  });

  it("consumer onboarding layout shows STEP 3 OF 3; coach banner does not", () => {
    const layout = readSrc("src/app/onboarding/layout.tsx");
    expect(layout).toContain("STEP 3 OF 3");
    expect(layout).toContain("Set Up Coach Pat");
    expect(layout).toContain("coachCompleteHero ? null");

    const coachStart = layout.indexOf('aria-label="Coach onboarding steps"');
    const consumerHeader = layout.indexOf("STEP 3 OF 3");
    const coachBlock = layout.slice(coachStart, consumerHeader);
    expect(coachStart).toBeGreaterThan(-1);
    expect(consumerHeader).toBeGreaterThan(coachStart);
    expect(coachBlock).toContain("Leadership Kit");
    expect(coachBlock).toContain("Complete onboarding");
    expect(coachBlock).not.toContain("Set Up Coach Pat");
    expect(coachBlock).not.toContain("STEP 3 OF 3");
  });

  it("progress uses PART 1–5 names, not Onboarding step X of 5", () => {
    const src = readSrc("src/components/onboarding-progress.tsx");
    expect(src).toContain(
      "PART {currentStep} OF {STEPS.length} — {STEPS[currentStep - 1].label.toUpperCase()}"
    );
    expect(src).not.toContain("Onboarding step");

    expect(renderToStaticMarkup(React.createElement(OnboardingProgress, { currentStep: 1 }))).toContain(
      "PART 1 OF 5 — IDENTITY"
    );
    expect(renderToStaticMarkup(React.createElement(OnboardingProgress, { currentStep: 2 }))).toContain(
      "PART 2 OF 5 — GOAL"
    );
    expect(renderToStaticMarkup(React.createElement(OnboardingProgress, { currentStep: 3 }))).toContain(
      "PART 3 OF 5 — REVIEW"
    );
    expect(renderToStaticMarkup(React.createElement(OnboardingProgress, { currentStep: 4 }))).toContain(
      "PART 4 OF 5 — TEXTS"
    );
    expect(renderToStaticMarkup(React.createElement(OnboardingProgress, { currentStep: 5 }))).toContain(
      "PART 5 OF 5 — COMPLETE"
    );
  });

  it("welcome keeps short duration copy and does not list five parts", () => {
    const src = readSrc("src/app/onboarding/page.tsx");
    expect(src).toContain("Takes about 2–3 minutes.");
    expect(src).toContain("Start Setup");
    expect(src).not.toContain("PART 1 OF 5");
    expect(src).not.toContain("Identity");
  });

  it("Identity page copy is unchanged aside from shared progress", () => {
    const page = readSrc("src/app/onboarding/identity/page.tsx");
    const client = readSrc("src/app/onboarding/identity/identity-client.tsx");
    expect(page).toContain("<OnboardingProgress currentStep={1} />");
    expect(page).not.toContain("Your trial is active");
    expect(client).toContain('continueLabel="Continue to My Current Goal →"');
  });

  it("Review button points to Daily Texts without changing the POST", () => {
    const src = readSrc("src/app/onboarding/review/review-acknowledge-button.tsx");
    expect(src).toContain("Looks Right — Next: Daily Texts →");
    expect(src).not.toContain("Looks right →");
    expect(src).toContain('fetch("/api/onboarding/review"');
    expect(src).toContain('router.push("/onboarding/sms")');
  });

  it("SMS body and CTA change; legal consent copy stays", () => {
    const page = readSrc("src/app/onboarding/sms/page.tsx");
    const client = readSrc("src/app/onboarding/sms/sms-client.tsx");
    expect(page).toContain("Daily Accountability Texts");
    expect(page).toContain(
      "This is where Summitt Mindset does its best work — daily accountability"
    );
    expect(page).toContain("texts from Coach Pat.");
    expect(client).toContain("Continue to Finish Setup →");
    expect(client).toContain(SMS_LEGAL_CONSENT);
    expect(client).toContain("Reply STOP to opt out");
    expect(client).toContain("Reply HELP for help");
    expect(client).toContain('href="/privacy"');
    expect(client).toContain('href="/terms"');
    expect(client).toContain('href="/sms"');
    expect(client).toContain("smsDisclosureAccepted: true");
  });

  it("Complete heading is Everything is ready; Finish Setup is unchanged", () => {
    const page = readSrc("src/app/onboarding/complete/page.tsx");
    const button = readSrc("src/components/CompleteOnboardingButton.tsx");
    expect(page).toContain("Everything is ready.");
    expect(page).not.toContain("Almost there.");
    expect(page).toContain(
      "Finish setup to activate your commitment and enter your Victory Room."
    );
    expect(button).toContain("Finish Setup →");
    expect(button).toContain('fetch("/api/onboarding/complete"');
    expect(button).toContain('router.push("/dashboard/victory-room")');
  });
});

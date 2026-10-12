import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CHALLENGER_BONUS_CTA, CHALLENGER_PRIMARY_CTA } from "@/components/challenger-landing-page";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import { PROUD_TEST_DEFINITION } from "@/lib/landing-experiment-shared";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("become-proud challenger", () => {
  const page = read("src/components/challenger-landing-page.tsx");
  const route = read("src/components/audience-landing-page.tsx");
  const home = read("src/app/page.tsx");
  const experiment = read("src/lib/landing-experiment-shared.ts");

  it("uses the approved hero, offer, and a different Pat photograph", () => {
    expect(CHALLENGER_PRIMARY_CTA).toBe("Put Coach Pat in My Corner");
    expect(page).toContain("Build a Life You're Proud Of.");
    expect(page).toContain("Remember How You Got There.");
    expect(page).toContain(
      "Get personal daily texts from Coach Pat to help you reach your goals, recognize how far you've come, and remember the moments that matter."
    );
    expect(page).toContain("7 days free · $0 today · Then {offer.monthly}");
    expect(page).toContain("{offer.cancel}.");
    expect(page).toContain('src="/brand/pat-summitt-challenger-hero.jpg"');
    expect(page).not.toContain("about-leadership.jpg");
    expect(page).not.toContain("ask-pat-coaching.jpg");
    expect(page).not.toContain("pat-summitt-homepage-hero.jpg");
    expect(page).not.toContain("pat_statue_grandkids");
    expect(page).not.toContain("home-hero-");
    expect(home).toContain("/brand/pat-summitt-homepage-hero.jpg");
    expect(home).toContain("Reach Your Goals.");
    expect(MEMBERSHIP_PUBLIC_OFFER.monthly).toBe("$29/month");
    expect(MEMBERSHIP_PUBLIC_OFFER.annual).toBe("$249/year");
    expect(MEMBERSHIP_PUBLIC_OFFER.cancel).toBe("Cancel anytime");
  });

  it("shows Linda's example, two victory cards, and the bonus benefits", () => {
    expect(page).toContain("The More You Share, the More Personal It Gets.");
    expect(page).not.toContain("Example conversation");
    expect(page).not.toContain("This illustration is not a private member text thread.");
    expect(page).toContain(
      "Linda, you told me you wanted to make more time for your family. How's that going?"
    );
    expect(page).toContain("Better! I've started putting my phone away when we're together.");
    expect(page).toContain("That's a win! Have you noticed a difference?");
    expect(page).toContain(
      "Yes! Yesterday my grandson and I spent the whole afternoon playing cards. He told me it was his favorite day."
    );
    expect(page).toContain(
      "I'll make sure we remember that afternoon, Linda. Let's keep making time for what matters most."
    );
    expect(page).not.toContain("Good morning, Judy!");
    expect(page).not.toContain("Judy, how's our goal");
    expect(page).toContain("Walked Four Days This Week!");
    expect(page).toContain("An Afternoon at the Park");
    expect(page).toContain("Example Victory Room. These cards are illustrations, not a real member's saved moments.");
    expect(page).not.toContain('value: "37"');
    expect(page).toContain("And There's Even More Included.");
    expect(page).toContain("Ask Pat");
    expect(page).toContain("Film Room");
    expect(page).toContain("Film Room Videos");
    expect(page).not.toContain("100+");
    expect(page).toContain("Online Programs");
    expect(page).toContain("Dozens of programs are included with your membership.");
    expect(CHALLENGER_BONUS_CTA).toBe("Get Everything — Start Free");
    expect(page).toContain("Included with your Summitt Mindset membership.");
  });

  it("shows four photographic Film Room lessons and no name-only placeholders", () => {
    expect(page).toContain("Peyton Manning");
    expect(page).toContain("No Shortcuts to Success");
    expect(page).toContain("/brand/film-room-peyton-manning.jpg");
    expect(page).toContain("Morgan Vance");
    expect(page).toContain("Personal Brand: What's Yours?");
    expect(page).toContain("/brand/film-room-morgan-vance.jpg");
    expect(page).toContain("Phillip Fulmer");
    expect(page).toContain("Set High Goals");
    expect(page).toContain("/brand/film-room-phillip-fulmer.jpg");
    expect(page).toContain("Pat Summitt");
    expect(page).toContain("Invest in Yourself");
    expect(page).toContain("/brand/film-room-pat-summitt-invest.jpg");
    expect(page).not.toContain("Model the Change");
    expect(page).not.toContain("aria-hidden=\"true\"");
    expect(page).not.toContain('href="/film-room');
  });

  it("keeps acquisition routing, paid-member redirect, and the planned experiment", () => {
    expect(route).toContain("marketingAcquisitionHref");
    expect(route).toContain("shouldShowMarketingPricingCopy");
    expect(route).toContain("marketingTrialCtaLabel");
    expect(route).toContain("marketingSubscribeCtaLabel");
    expect(route).toContain('redirect("/post-sign-in")');
    expect(route).toContain("isSubscribedFromPublicMetadata");
    expect(page).toContain('data-growth-cta="trial"');
    expect(page).toContain("data-growth-surface={surface}");
    expect(page).toContain("!text-[#111827]");
    expect(page).toContain("min-h-14");
    expect(experiment).toContain('challenger: "/become-proud"');
    expect(PROUD_TEST_DEFINITION.nextAction).toContain("Do not send existing homepage visitors");
    expect(route).not.toContain("assignProudTestVariant");
    expect(page).not.toContain("assignProudTestVariant");
  });
});

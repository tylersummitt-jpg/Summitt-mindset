import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exampleSeptemberSlots } from "@/components/homepage-victory-room";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("homepage redesign phase 2", () => {
  const home = read("src/app/page.tsx");

  it("keeps the approved hero and the seven-section order", () => {
    const markers = [
      "Reach Your Goals.",
      "Remember the Journey.",
      "Get daily text messages from Coach Pat to help you reach your goals, celebrate your wins, and remember the special moments along the way.",
      "<HomepageSmsExample />",
      "<HomepageHowItWorksSteps />",
      "<HomepageVictoryRoom />",
      "<HomepageMemberTestimonials />",
      "Inspired by Pat Summitt. Made for Your Life.",
      "Your Next Chapter Starts Today.",
    ];
    let last = -1;
    for (const marker of markers) {
      const index = home.indexOf(marker);
      expect(index).toBeGreaterThan(last);
      last = index;
    }
    expect(home).toContain("7 days free · $0 today · Cancel anytime");
    expect(home).not.toContain("HomepageMobileStickyCta");
    expect(home).not.toContain("HomepageHowItWorksVideo");
    expect(home).not.toContain("/api/quote-of-the-day");
    expect(home).not.toContain("VictoryWinCard");
    expect(home).not.toContain("VictorySummaryCounts");
  });

  it("routes the final trial button through the existing helpers", () => {
    expect(home).toContain("marketingAcquisitionHref");
    expect(home).toContain("shouldShowMarketingPricingCopy");
    expect(home).toContain("const finalHref = user ? subscribeCtaHref : signInSubscribeHref;");
    expect(home).toContain('href={finalHref}');
    expect(home).toContain('redirect("/post-sign-in")');
    expect(home).toContain("MEMBERSHIP_PUBLIC_OFFER");
    expect(home).toContain(
      "Then {MEMBERSHIP_PUBLIC_OFFER.monthly}, or choose {MEMBERSHIP_PUBLIC_OFFER.annual}."
    );
    expect(home).toContain("$0 Today");
    expect(home).toContain("Try Summitt Mindset free for 7 days.");
    expect(home).toContain("{showPricingCopy ? (");
    expect(MEMBERSHIP_PUBLIC_OFFER.monthly).toBe("$29/month");
    expect(MEMBERSHIP_PUBLIC_OFFER.annual).toBe("$249/year");
    expect(MEMBERSHIP_PUBLIC_OFFER.trial).toBe("7-day free trial");
    expect(MEMBERSHIP_PUBLIC_OFFER.cancel).toBe("Cancel anytime");
  });

  it("labels the SMS thread as a fictional example", () => {
    const sms = read("src/components/homepage-sms-example.tsx");
    expect(sms).toContain("A Little Conversation Can Change Your Day.");
    expect(sms).toContain(
      "Example conversation. This is not a real member's text thread."
    );
    expect(sms).toContain("Good morning, Judy! You wanted to walk every day this week. How's that going?");
    expect(sms).toContain("Then let's keep making progress and noticing those special moments!");
    expect(sms).toContain("bg-[#E9E9EB]");
    expect(sms).toContain("bg-[#0E6B32]");
    expect(sms).toContain("text-white");
    expect(sms).not.toContain("Victory Room");
    expect(sms).not.toMatch(/<img|next\/image/);
    expect(sms).not.toContain("<button");
    expect(sms).not.toContain("<input");
    expect(sms).not.toContain("overflow-y-auto");
    expect(sms).not.toContain("gradient");
  });

  it("shows an example Victory Room without member data or fake controls", () => {
    const room = read("src/components/homepage-victory-room.tsx");
    expect(room).toContain("Don't Just Live the Moments. Remember Them.");
    expect(room).toContain("The progress you make toward your goals.");
    expect(room).toContain("The special moments in your life you want to remember.");
    expect(room).toContain("Example Victory Room");
    expect(room).toContain("Example lifetime totals. They are not the number of victories in September.");
    expect(room).toContain('value: "37"');
    expect(room).toContain('value: "7"');
    expect(room).toContain('value: "30"');
    expect(room).toContain("September 2026");
    expect(room).toContain("Walked Four Days This Week!");
    expect(room).toContain("Ice Cream With My Granddaughter");
    expect(room).toContain("An Afternoon at the Park");
    expect(room).toContain("18: \"goal\"");
    expect(room).toContain("21: \"proud\"");
    expect(room).toContain("28: \"proud\"");
    expect(room).not.toContain("<img");
    expect(room).not.toContain("<button");
    expect(room).not.toContain("VictoryWinCard");
    expect(room).not.toContain("VictoryCalendarGrid");
    expect(room).not.toContain("/dashboard/victory-room");

    const slots = exampleSeptemberSlots();
    expect(new Date(Date.UTC(2026, 8, 1)).getUTCDay()).toBe(2);
    expect(slots[0]).toBeNull();
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBe(1);
    expect(slots).toContain(18);
    expect(slots).toContain(30);
    expect(slots.filter((day) => day != null)).toHaveLength(30);
  });
});

/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PartnerLandingPage } from "@/components/partner-landing-page";
import { isMarketingPageViewPath, mergeFirstTouch } from "@/lib/marketing-attribution-pure";
import {
  PARTNER_LANDINGS,
  isPartnerLandingPath,
  partnerCheckoutHref,
  partnerLandingByPath,
} from "@/lib/partner-landing";

vi.mock("next/image", () => ({
  default: (props: { alt?: string; src?: string }) => (
    <img alt={props.alt ?? ""} src={props.src ?? ""} />
  ),
}));

const root = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("partner landing pages", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders both partners, the correct video, and a disabled checkout until the price is ready", () => {
    for (const partner of PARTNER_LANDINGS) {
      const view = render(
        <PartnerLandingPage partner={partner} channel="unknown" checkoutReady={false} />
      );
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "50% Off for the"
      );
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        partner.headlineAccent
      );
      expect(screen.getByRole("img", { name: partner.name }).getAttribute("src")).toBe(
        partner.logoSrc
      );
      expect(
        screen.getByText(
          "Get a FREE signed book plus daily coaching texts from Coach Pat for just $179/year."
        )
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: partner.videoHeading })).toBeTruthy();
      const frame = view.container.querySelector("iframe");
      expect(frame?.getAttribute("src")).toBe(
        `https://player.vimeo.com/video/${partner.vimeoVideoId}?dnt=1`
      );
      expect(screen.getAllByRole("button", { name: "Claim My Special Offer" })).toHaveLength(2);
      for (const button of screen.getAllByRole("button", { name: "Claim My Special Offer" })) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      }
      expect(screen.getAllByText("Exclusive checkout coming soon.")).toHaveLength(2);
      expect(screen.getByText("7 days free · Then $179/year · Cancel anytime")).toBeTruthy();
      expect(screen.getByText("$179/year")).toBeTruthy();
      expect(
        screen.getByText("Your exclusive partner rate renews at $179/year.")
      ).toBeTruthy();
      expect(screen.getByText("Includes a FREE signed book.")).toBeTruthy();
      expect(screen.getByText("A Little Conversation Can Change Your Day.")).toBeTruthy();
      expect(screen.getByText("It's as Easy as Sending a Text.")).toBeTruthy();
      expect(view.container.querySelector("a")).toBeNull();
      expect(view.container.innerHTML).not.toContain("/checkout/start");
      expect(view.container.innerHTML).not.toContain("/subscribe");
      view.unmount();
    }
  });

  it("points a ready checkout at partner_annual for that partner and channel", () => {
    const partner = partnerLandingByPath("/orange-mountain-designs");
    const href = partnerCheckoutHref(partner.key, "email");
    const view = render(
      <PartnerLandingPage partner={partner} channel="email" checkoutReady />
    );
    const links = screen.getAllByRole("link", { name: "Claim My Special Offer" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(href);
    }
    expect(href).toContain("plan=partner_annual");
    expect(href).toContain("partner=orange-mountain-designs");
    expect(href).toContain("channel=email");
    expect(view.container.innerHTML).not.toContain("plan=monthly");
    expect(view.container.innerHTML).not.toContain("plan=annual");
    expect(view.container.innerHTML).not.toContain("/subscribe");
    expect(partnerLandingByPath("/lady-vol-boost-her-club").vimeoVideoId).toBe("1243381662");
    expect(partner.vimeoVideoId).toBe("1243381661");
  });

  it("keeps the routes public for page views without widening other paths", () => {
    const middleware = read("src/middleware.ts");
    for (const partner of PARTNER_LANDINGS) {
      expect(middleware).toContain(`"${partner.path}"`);
      expect(isMarketingPageViewPath(partner.path)).toBe(true);
      expect(isPartnerLandingPath(partner.path)).toBe(true);
      expect(isMarketingPageViewPath(`${partner.path}/extra`)).toBe(false);
    }
    expect(isMarketingPageViewPath("/")).toBe(true);
    expect(isMarketingPageViewPath("/checkout/start")).toBe(false);
    expect(isMarketingPageViewPath("/for/abc")).toBe(false);
    expect(partnerLandingByPath("/orange-mountain-designs").name).toBe(
      "Orange Mountain Designs"
    );
    expect(partnerLandingByPath("/lady-vol-boost-her-club").name).toBe(
      "Lady Vol Boost Her Club"
    );
  });

  it("leaves the homepage, checkout, and first-touch merge untouched", () => {
    const homepage = read("src/app/page.tsx");
    expect(homepage).toContain('href={signInSubscribeHref}');
    expect(homepage).toContain('href="/checkout/start?plan=annual"');
    expect(homepage).toContain("Start My Free Trial");
    expect(homepage).not.toContain("Claim My Special Offer");
    expect(homepage).not.toContain("orange-mountain-designs");
    expect(homepage).not.toContain("lady-vol-boost-her-club");

    const cta = read("src/components/partner-offer-cta.tsx");
    expect(cta).toContain("disabled");
    expect(cta).toContain("Exclusive checkout coming soon.");
    expect(cta).not.toContain("/subscribe");
    expect(cta).not.toContain("fetch(");

    const navbar = read("src/components/Navbar.tsx");
    const reduced = navbar.slice(navbar.indexOf("isPartnerLandingPath(pathname)"));
    const reducedOnly = reduced.slice(0, reduced.indexOf("const startFreeTrialHref"));
    expect(reducedOnly).toContain("Learn More →");
    expect(reducedOnly).not.toContain("Start Free Trial");

    const first = mergeFirstTouch(
      null,
      {
        source_normalized: "google",
        is_paid_acquisition: true,
        source_detail: null,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring",
        utm_content: null,
        referrer_host: null,
        gclid_present: false,
        fbclid_present: false,
      },
      "2026-11-02T00:00:00.000Z"
    );
    const later = mergeFirstTouch(
      first,
      {
        source_normalized: "referral",
        is_paid_acquisition: false,
        source_detail: null,
        utm_source: "omd",
        utm_medium: "email",
        utm_campaign: "partner",
        utm_content: null,
        referrer_host: null,
        gclid_present: false,
        fbclid_present: false,
      },
      "2026-11-02T01:00:00.000Z"
    );
    expect(later.utm_source).toBe("google");
    expect(later.source_normalized).toBe("google");
  });
});

/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  HomepageMemberTestimonials,
  MEMBER_TESTIMONIALS,
  resolveTestimonialSwipe,
  TESTIMONIAL_SWIPE_THRESHOLD_PX,
} from "@/components/homepage-member-testimonials";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const KATHY =
  "\u201CCoach Pat\u201D encourages me, challenges me, and reminds me of what I\u2019m capable of. My whole approach to life is changing and life feels easier.";
const KATHY_OLD =
  "Talking with \u201CCoach Pat\u201D through Summitt Mindset feels like having Pat Summitt sitting on my shoulder";
const JORDAN =
  "Summitt Mindset is as close as somebody can get to having Pat Summitt as a life coach.";
const RB =
  "Summitt Mindset carries forward the kind of accountability Pat believed in. It is simple, direct, and built to help people follow through.";
const JACKIE =
  "I\u2019ve really enjoyed the daily text messages. Some days they remind me, and some days they challenge me. Either way, they help me work on becoming a better version of myself.";

function paragraphText(): string {
  const quote = document.querySelector("blockquote");
  if (!quote) return "";
  return Array.from(quote.querySelectorAll("p"))
    .map((node) => node.textContent ?? "")
    .join(" ");
}

function swipe(from: { x: number; y: number }, to: { x: number; y: number }) {
  const region = screen.getByRole("region", { name: "Member testimonials" });
  fireEvent.touchStart(region, {
    changedTouches: [{ clientX: from.x, clientY: from.y }],
  });
  fireEvent.touchEnd(region, {
    changedTouches: [{ clientX: to.x, clientY: to.y }],
  });
}

describe("homepage member testimonials", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps four testimonials in a fixed order", () => {
    expect(MEMBER_TESTIMONIALS).toHaveLength(4);
    expect(MEMBER_TESTIMONIALS.map((item) => item.id)).toEqual([
      "kathy",
      "jordan",
      "rb",
      "jackie",
    ]);
  });

  it("shows Kathy first and only one blockquote", () => {
    render(<HomepageMemberTestimonials />);
    expect(document.querySelectorAll("blockquote")).toHaveLength(1);
    expect(paragraphText()).toBe(KATHY);
    expect(paragraphText()).not.toContain(KATHY_OLD);
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();
    expect(screen.getByText(/Oregon/)).toBeInTheDocument();
    expect(document.querySelector("blockquote p")?.className).toBe(
      "text-lg font-semibold leading-relaxed text-gray-950 sm:text-xl lg:text-2xl"
    );
    expect(screen.queryByText("Jordan P.")).not.toBeInTheDocument();
    expect(screen.queryByText("R.B. Summitt")).not.toBeInTheDocument();
    expect(screen.queryByText("Jackie D.")).not.toBeInTheDocument();
  });

  it("shows Jordan, R.B., and Jackie with exact copy when selected", async () => {
    const user = userEvent.setup();
    render(<HomepageMemberTestimonials />);

    await user.click(screen.getByRole("button", { name: "Show testimonial 2 of 4, Jordan P." }));
    expect(paragraphText()).toBe(JORDAN);
    expect(screen.getByText("Jordan P.")).toBeInTheDocument();
    expect(screen.getByText(/Father of 2/)).toBeInTheDocument();
    expect(document.querySelector("blockquote p")?.className).not.toMatch(
      /orange|1\.12em|font-bold/
    );

    await user.click(screen.getByRole("button", { name: "Show testimonial 3 of 4, R.B. Summitt" }));
    expect(paragraphText()).toBe(RB);
    expect(screen.getByText("R.B. Summitt")).toBeInTheDocument();
    expect(screen.getByText(/Pat\u2019s former husband/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show testimonial 4 of 4, Jackie D." }));
    expect(paragraphText()).toBe(JACKIE);
    expect(screen.getByText("Jackie D.")).toBeInTheDocument();
    expect(screen.getByText(/Ohio/)).toBeInTheDocument();
    expect(document.querySelectorAll("blockquote")).toHaveLength(1);
  });

  it("cycles next and previous with wrap, and marks the active dot", async () => {
    const user = userEvent.setup();
    render(<HomepageMemberTestimonials />);
    const next = screen.getByRole("button", { name: "Next testimonial" });
    const previous = screen.getByRole("button", { name: "Previous testimonial" });

    expect(
      screen.getByRole("button", { name: "Show testimonial 1 of 4, Kathy P." })
    ).toHaveAttribute("aria-current", "true");

    await user.click(next);
    expect(screen.getByText("Jordan P.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show testimonial 2 of 4, Jordan P." })
    ).toHaveAttribute("aria-current", "true");

    await user.click(next);
    expect(screen.getByText("R.B. Summitt")).toBeInTheDocument();
    await user.click(next);
    expect(screen.getByText("Jackie D.")).toBeInTheDocument();
    await user.click(next);
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();

    await user.click(previous);
    expect(screen.getByText("Jackie D.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show testimonial 4 of 4, Jackie D." })
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Show testimonial 1 of 4, Kathy P." })
    ).not.toHaveAttribute("aria-current");
  });

  it("moves with arrow keys only while focus is inside the region", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <HomepageMemberTestimonials />
      </div>
    );

    await user.click(screen.getByRole("button", { name: "Outside" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();
    expect(screen.queryByText("Jordan P.")).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Next testimonial" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Jordan P.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next testimonial" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();
  });

  it("swipes horizontally and ignores short or vertical touches", () => {
    render(<HomepageMemberTestimonials />);

    swipe({ x: 200, y: 40 }, { x: 200 - TESTIMONIAL_SWIPE_THRESHOLD_PX, y: 40 });
    expect(screen.getByText("Jordan P.")).toBeInTheDocument();

    swipe({ x: 40, y: 40 }, { x: 40 + TESTIMONIAL_SWIPE_THRESHOLD_PX, y: 40 });
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();

    swipe({ x: 80, y: 40 }, { x: 80 + TESTIMONIAL_SWIPE_THRESHOLD_PX - 1, y: 40 });
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();

    swipe({ x: 100, y: 20 }, { x: 100 + 80, y: 20 + 90 });
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();
    expect(screen.queryByText("Jackie D.")).not.toBeInTheDocument();
  });

  it("classifies swipe intent without treating a vertical move as a slide", () => {
    expect(resolveTestimonialSwipe({ x: 100, y: 10 }, { x: 40, y: 12 })).toBe("next");
    expect(resolveTestimonialSwipe({ x: 40, y: 10 }, { x: 100, y: 12 })).toBe("previous");
    expect(resolveTestimonialSwipe({ x: 10, y: 10 }, { x: 40, y: 10 })).toBeNull();
    expect(resolveTestimonialSwipe({ x: 10, y: 10 }, { x: 70, y: 80 })).toBeNull();
  });

  it("does not autoplay or use a horizontal scroller", () => {
    const source = read("src/components/homepage-member-testimonials.tsx");
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toMatch(/scroll-snap|snap-x|snap-mandatory/);
    expect(source).not.toMatch(/swiper|embla|keen-slider/);
    expect(source).not.toContain("onTouchMove");
    expect(source).not.toMatch(/touchmove[\s\S]{0,120}preventDefault/i);
    expect(source).toContain('"use client"');
    expect(source).not.toContain("emphasis");
    expect(source).not.toContain("text-orange-700");
    expect(source).not.toContain("text-[1.12em]");
    expect(source).toContain("min-h-[11.5rem]");
    expect(source).toContain("min-[360px]:min-h-[9.5rem]");
    expect(source).toContain("min-[430px]:min-h-[7.75rem]");
    expect(source).toContain("sm:min-h-[6.5rem]");
    expect(source).toContain("lg:min-h-[7.75rem]");
    expect(source).not.toContain("sitting on my shoulder");
  });

  it("keeps the homepage server component, legacy section, and trial CTA", () => {
    const page = read("src/app/page.tsx");
    expect(page).not.toContain('"use client"');
    expect(page).toContain("<HomepageMemberTestimonials />");
    expect(page).not.toContain("built to help people follow through");
    expect(page).not.toContain("A FAMILY PERSPECTIVE");
    expect(page).toContain("Created by Pat Summitt&apos;s family.");
    expect(page).toContain("A TRUSTED LEGACY");
    expect(page).toContain("Rooted in her legacy. Built for real life.");
    expect(page).toContain("marketingAcquisitionHref");
    expect(page).toContain("trialCtaLabelLong");
    expect(page).toContain("Coach Pat in your corner.");
  });
});

/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  HomepageMemberTestimonials,
  MEMBER_TESTIMONIALS,
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

  it("shows all four approved quotes at once", () => {
    render(<HomepageMemberTestimonials />);
    expect(
      screen.getByRole("heading", { name: "Real People. Real Progress." })
    ).toBeInTheDocument();
    expect(document.querySelectorAll("blockquote")).toHaveLength(4);
    expect(screen.getByText(KATHY)).toBeInTheDocument();
    expect(screen.getByText(KATHY)).not.toHaveTextContent(KATHY_OLD);
    expect(screen.getByText("Kathy P.")).toBeInTheDocument();
    expect(screen.getByText(/Oregon/)).toBeInTheDocument();
    expect(screen.getByText(JORDAN)).toBeInTheDocument();
    expect(screen.getByText("Jordan P.")).toBeInTheDocument();
    expect(screen.getByText(/Father of 2/)).toBeInTheDocument();
    expect(screen.getByText(RB)).toBeInTheDocument();
    expect(screen.getByText("R.B. Summitt")).toBeInTheDocument();
    expect(screen.getByText(/Pat\u2019s former husband/)).toBeInTheDocument();
    expect(screen.getByText(JACKIE)).toBeInTheDocument();
    expect(screen.getByText("Jackie D.")).toBeInTheDocument();
    expect(screen.getByText(/Ohio/)).toBeInTheDocument();
    expect(document.querySelector("blockquote p")?.className).toMatch(/text-lg/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not rotate, swipe, or hide quotes", () => {
    const source = read("src/components/homepage-member-testimonials.tsx");
    expect(source).not.toMatch(/setInterval|setTimeout|useState|onTouchStart/);
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toMatch(/scroll-snap|snap-x|snap-mandatory/);
    expect(source).not.toMatch(/swiper|embla|keen-slider/);
    expect(source).not.toContain("resolveTestimonialSwipe");
    expect(source).not.toContain("sitting on my shoulder");
    expect(source).not.toContain("text-orange-700");
    expect(source).not.toContain("text-[1.12em]");
  });

  it("keeps the homepage server component and the shortened legacy section", () => {
    const page = read("src/app/page.tsx");
    expect(page).not.toContain('"use client"');
    expect(page).toContain("<HomepageMemberTestimonials />");
    expect(page).not.toContain("built to help people follow through");
    expect(page).not.toContain("A FAMILY PERSPECTIVE");
    expect(page).toContain("Inspired by Pat Summitt. Made for Your Life.");
    expect(page).not.toContain("A TRUSTED LEGACY");
    expect(page).not.toContain("Rooted in her legacy. Built for real life.");
    expect(page).toContain("marketingAcquisitionHref");
    expect(page).toContain("Reach Your Goals.");
  });
});

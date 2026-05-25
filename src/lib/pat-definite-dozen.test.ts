import { describe, expect, it } from "vitest";
import { PAT_DEFINITE_DOZEN, PAT_PRINCIPLE_IDS } from "@/lib/pat-definite-dozen";

const CANONICAL_TITLES = [
  "Respect Yourself and Others",
  "Take Full Responsibility",
  "Develop and Demonstrate Loyalty",
  "Learn to Be a Great Communicator",
  "Discipline Yourself So No One Else Has To",
  "Make Hard Work Your Passion",
  "Don’t Just Work Hard, Work Smart",
  "Put the Team Before Yourself",
  "Make Winning an Attitude",
  "Be a Competitor",
  "Change Is a Must",
  "Handle Success Like You Handle Failure",
];

describe("pat-definite-dozen", () => {
  it("has exactly 12 principles with unique slugs and orders", () => {
    expect(PAT_DEFINITE_DOZEN).toHaveLength(12);
    expect(PAT_PRINCIPLE_IDS).toHaveLength(12);
    const slugs = new Set(PAT_DEFINITE_DOZEN.map((p) => p.id));
    const orders = new Set(PAT_DEFINITE_DOZEN.map((p) => p.order));
    expect(slugs.size).toBe(12);
    expect(orders.size).toBe(12);
  });

  it("titles match canonical list in order", () => {
    const titles = PAT_DEFINITE_DOZEN.map((p) => p.title);
    expect(titles).toEqual(CANONICAL_TITLES);
  });

  it("coach lines avoid quotes and Pat-said framing", () => {
    for (const p of PAT_DEFINITE_DOZEN) {
      const combined = `${p.shortCoachLine} ${p.focusPracticeHint}`;
      expect(combined).not.toMatch(/pat said/i);
      expect(combined).not.toContain("\u201C");
      expect(combined).not.toContain('"');
    }
  });
});

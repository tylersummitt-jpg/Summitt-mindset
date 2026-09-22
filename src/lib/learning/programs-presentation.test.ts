import { describe, expect, it } from "vitest";
import { nativeSortDirections, proseBesideReveal } from "./programs-presentation";

describe("programs presentation rules", () => {
  it("removes a list that only repeats the reveal titles", () => {
    const text = proseBesideReveal(
      [
        "Coach Summitt found that several physical habits help build self-respect.",
        "Keep moving",
        "Sleep",
        "To summarize, these habits build self-respect from within.",
        "Keep moving",
        "Sleep",
      ].join("\n\n"),
      ["Keep moving", "Sleep"]
    );
    expect(text).toContain("Coach Summitt found");
    expect(text).toContain("To summarize");
    expect(text).not.toContain("Keep moving");
    expect(text).not.toContain("Sleep");
  });

  it("rewrites stack and drag instructions into the one-item activity", () => {
    expect(
      nativeSortDirections("Sort the stack of cards below into the right category.", [
        "Great ways to earn respect",
        "Ways to destroy or harm respect",
      ])
    ).toBe(
      "You'll see one item at a time. Decide whether it belongs with “Great ways to earn respect” or “Ways to destroy or harm respect.”"
    );
    expect(nativeSortDirections("Drag each card into a category.", ["A", "B"])).toMatch(/one item at a time/);
    const native = "You'll see one action at a time. Decide whether it earns respect.";
    expect(nativeSortDirections(native, ["A", "B"])).toBe(native);
  });
});
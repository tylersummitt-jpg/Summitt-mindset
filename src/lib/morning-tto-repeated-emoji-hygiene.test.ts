import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RECENT_SENT_COACH_EMOJI_LOOKBACK,
  applyRepeatedCoachEmojiHygiene,
  extractEmojiSequences,
  recentSentCoachBodiesFromExactThread,
} from "@/lib/morning-tto-repeated-emoji-hygiene";

function coach(body: string) {
  return { sender: "coach" as const, body };
}
function user(body: string) {
  return { sender: "user" as const, body };
}

describe("morning-tto-repeated-emoji-hygiene", () => {
  it("lookback is the previous 5 successfully sent Coach SMS", () => {
    expect(RECENT_SENT_COACH_EMOJI_LOOKBACK).toBe(5);
  });

  it("extracts common Coach emoji sequences", () => {
    expect(extractEmojiSequences("Great job today. 🩵")).toEqual(["🩵"]);
    expect(extractEmojiSequences("Keep going 🧡 🙏 🙌 ❤️ 👍 💪")).toEqual([
      "🧡",
      "🙏",
      "🙌",
      "❤️",
      "👍",
      "💪",
    ]);
  });

  it("1. repeated emoji in prior 5 is removed", () => {
    const recent = recentSentCoachBodiesFromExactThread([
      coach("Great job today. 🩵"),
      user("Thanks"),
      coach("See you tomorrow."),
    ]);
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "Keep going tomorrow. 🩵",
        recentSentCoachBodies: recent,
      })
    ).toBe("Keep going tomorrow.");
  });

  it("2. emoji used 6 Coach messages ago but not in prior 5 is allowed", () => {
    const recent = recentSentCoachBodiesFromExactThread([
      coach("Old stamp. 🩵"),
      coach("One."),
      coach("Two."),
      coach("Three."),
      coach("Four."),
      coach("Five."),
    ]);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toBe("One.");
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "That's a big win. 🩵",
        recentSentCoachBodies: recent,
      })
    ).toBe("That's a big win. 🩵");
  });

  it("3. new emoji not in prior 5 is kept", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "That was strong work. 🙌",
        recentSentCoachBodies: ["Great job today. 🩵"],
      })
    ).toBe("That was strong work. 🙌");
  });

  it("4. no emoji is unchanged", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "Keep going tomorrow.",
        recentSentCoachBodies: ["Great job today. 🩵"],
      })
    ).toBe("Keep going tomorrow.");
  });

  it("5. repeated emoji removal cleans leftover spacing and punctuation", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "That's a win 🩵!",
        recentSentCoachBodies: ["Nice 🩵"],
      })
    ).toBe("That's a win!");
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "Keep going. 🩵",
        recentSentCoachBodies: ["Nice 🩵"],
      })
    ).toBe("Keep going.");
  });

  it("6. multiple emoji: only the recently repeated one is removed", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "Strong work. 🩵 🙌",
        recentSentCoachBodies: ["Great job today. 🩵"],
      })
    ).toBe("Strong work. 🙌");
  });

  it("7. user emoji and non-coach rows are not a repeat source", () => {
    const recent = recentSentCoachBodiesFromExactThread([
      user("Yes!! 🩵"),
      coach("Got it."),
      user("Draft-looking 🧡"),
    ]);
    expect(recent).toEqual(["Got it."]);
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "Keep going tomorrow. 🩵",
        recentSentCoachBodies: recent,
      })
    ).toBe("Keep going tomorrow. 🩵");
  });

  it("history with no emoji keeps a new emoji", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "That's a big win. 🩵",
        recentSentCoachBodies: ["How did it go?"],
      })
    ).toBe("That's a big win. 🩵");
  });

  it("does not substitute a different emoji", () => {
    const out = applyRepeatedCoachEmojiHygiene({
      body: "Keep going tomorrow. 🩵",
      recentSentCoachBodies: ["Great job today. 🩵"],
    });
    expect(out).toBe("Keep going tomorrow.");
    expect(out).not.toMatch(/💙|🧡|🙌/);
  });

  it("does not empty a body that was only a repeated emoji", () => {
    expect(
      applyRepeatedCoachEmojiHygiene({
        body: "🩵",
        recentSentCoachBodies: ["Nice 🩵"],
      })
    ).toBe("🩵");
  });

  it("8. Morning and Evening generate share this helper; Weekly does not", () => {
    const generateSrc = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    const weeklySrc = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-weekly-generate.ts"),
      "utf8"
    );
    const morningStart = generateSrc.indexOf(
      "export async function generateTylerTextOverviewDraftForUser"
    );
    const eveningStart = generateSrc.indexOf(
      "export async function generateTylerTextOverviewEveningPreviewForUser"
    );
    const morningFn = generateSrc.slice(morningStart, eveningStart);
    const eveningFn = generateSrc.slice(eveningStart);
    expect(morningFn).toContain("hygienedMorningEveningSmsBody");
    expect(eveningFn).toContain("hygienedMorningEveningSmsBody");
    expect(generateSrc).toContain("applyRepeatedCoachEmojiHygiene");
    expect(generateSrc).toContain("recentSentCoachBodiesFromExactThread");
    expect(weeklySrc).not.toContain("applyRepeatedCoachEmojiHygiene");
    expect(weeklySrc).not.toContain("morning-tto-repeated-emoji-hygiene");
  });
});

import { describe, expect, it } from "vitest";
import { WIN_FIELD_LIMITS } from "@/lib/openai-win-recognition-v1";
import { normalizeSolTrophyTitle } from "@/lib/inbound-sol-coaching-brief";
import {
  WIN_DISPLAY_TITLE_MAX_CHARS,
  WIN_DISPLAY_TITLE_SAFE_FALLBACK,
  limitWinDisplayTitle,
  limitWinDisplayTitleOrFallback,
} from "@/lib/v2-win-display-title";

const LONG_SWIM =
  "Swam with the children and shared in their excitement during the family experience";

describe("limitWinDisplayTitle", () => {
  it("matches the 80-char display_title CHECK", () => {
    expect(WIN_DISPLAY_TITLE_MAX_CHARS).toBe(80);
    expect(WIN_DISPLAY_TITLE_MAX_CHARS).toBe(WIN_FIELD_LIMITS.display_title);
    expect(WIN_DISPLAY_TITLE_SAFE_FALLBACK.length).toBeLessThanOrEqual(80);
  });

  it("leaves 79-char and 80-char titles unchanged", () => {
    const t79 = "a".repeat(79);
    const t80 = "a".repeat(80);
    expect(limitWinDisplayTitle(t79)).toBe(t79);
    expect(limitWinDisplayTitle(t80)).toBe(t80);
  });

  it("cuts the swimming example at a complete word, never family experien", () => {
    expect(LONG_SWIM.length).toBeGreaterThan(80);
    const limited = limitWinDisplayTitle(LONG_SWIM);
    expect(limited).toBe(
      "Swam with the children and shared in their excitement during the family"
    );
    expect(limited!.length).toBeLessThanOrEqual(80);
    expect(limited).not.toContain("experien");
    expect(limited!.endsWith("family")).toBe(true);
  });

  it("returns null for a single unbroken token longer than 80", () => {
    expect(limitWinDisplayTitle("x".repeat(81))).toBeNull();
    expect(limitWinDisplayTitleOrFallback("x".repeat(81))).toBe(
      WIN_DISPLAY_TITLE_SAFE_FALLBACK
    );
  });

  it("does not mid-word slice when the 80th character ends a complete word", () => {
    const prefix = "Hello world ";
    const rest = "x".repeat(80 - prefix.length);
    const exact = prefix + rest;
    expect(exact.length).toBe(80);
    expect(limitWinDisplayTitle(`${exact} extra`)).toBe(exact);
  });
});

describe("trophy title law is unchanged", () => {
  it("still rejects trophy titles over 80 instead of slicing", () => {
    expect(normalizeSolTrophyTitle(LONG_SWIM)).toBeNull();
    expect(normalizeSolTrophyTitle(`${"x".repeat(81)}`)).toBeNull();
    expect(normalizeSolTrophyTitle("Lifted Weights")).toBe("Lifted Weights");
  });
});

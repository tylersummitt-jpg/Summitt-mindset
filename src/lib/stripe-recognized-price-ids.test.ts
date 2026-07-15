import { describe, expect, it } from "vitest";
import {
  getRecognizedSummittPriceIds,
  isRecognizedSummittPriceId,
  parseStripePriceIdList,
} from "@/lib/stripe-recognized-price-ids";

/** Live Summitt Price IDs (fixtures for clarity; runtime still uses env). */
const LEGACY_MONTHLY = "price_1SzRiNHP6uKt4BBok7FrpmQY";
const LEGACY_ANNUAL = "price_1SZY92HP6uKt4BBo9gP2ZMXb";
const NEW_MONTHLY = "price_1TtRauHP6uKt4BBoupJRggJ2";
const NEW_ANNUAL = "price_1TtRdEHP6uKt4BBo0Ex8Xw8a";

describe("parseStripePriceIdList", () => {
  it("returns empty for missing / empty / non-string", () => {
    expect(parseStripePriceIdList(undefined)).toEqual([]);
    expect(parseStripePriceIdList(null)).toEqual([]);
    expect(parseStripePriceIdList("")).toEqual([]);
    expect(parseStripePriceIdList("   ")).toEqual([]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(
      parseStripePriceIdList(
        ` ${LEGACY_MONTHLY} , , ${LEGACY_ANNUAL} ,  `
      )
    ).toEqual([LEGACY_MONTHLY, LEGACY_ANNUAL]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(
      parseStripePriceIdList(
        `${LEGACY_MONTHLY},${LEGACY_ANNUAL},${LEGACY_MONTHLY}`
      )
    ).toEqual([LEGACY_MONTHLY, LEGACY_ANNUAL]);
  });
});

describe("getRecognizedSummittPriceIds", () => {
  it("includes current monthly and annual env IDs", () => {
    const set = getRecognizedSummittPriceIds({
      monthly: NEW_MONTHLY,
      annual: NEW_ANNUAL,
      legacyCsv: undefined,
    });
    expect(set.has(NEW_MONTHLY)).toBe(true);
    expect(set.has(NEW_ANNUAL)).toBe(true);
    expect(set.size).toBe(2);
  });

  it("includes legacy IDs from STRIPE_LEGACY_PRICE_IDS CSV", () => {
    const set = getRecognizedSummittPriceIds({
      monthly: NEW_MONTHLY,
      annual: NEW_ANNUAL,
      legacyCsv: `${LEGACY_MONTHLY},${LEGACY_ANNUAL}`,
    });
    expect(set.has(NEW_MONTHLY)).toBe(true);
    expect(set.has(NEW_ANNUAL)).toBe(true);
    expect(set.has(LEGACY_MONTHLY)).toBe(true);
    expect(set.has(LEGACY_ANNUAL)).toBe(true);
    expect(set.size).toBe(4);
  });

  it("tolerates absent legacy CSV without throwing", () => {
    expect(() =>
      getRecognizedSummittPriceIds({
        monthly: NEW_MONTHLY,
        annual: NEW_ANNUAL,
      })
    ).not.toThrow();
  });

  it("trims monthly/annual and dedupes against legacy list", () => {
    const set = getRecognizedSummittPriceIds({
      monthly: ` ${NEW_MONTHLY} `,
      annual: NEW_ANNUAL,
      legacyCsv: `${NEW_MONTHLY},${LEGACY_MONTHLY}`,
    });
    expect([...set].sort()).toEqual(
      [NEW_MONTHLY, NEW_ANNUAL, LEGACY_MONTHLY].sort()
    );
  });

  it("ignores empty monthly/annual", () => {
    const set = getRecognizedSummittPriceIds({
      monthly: "",
      annual: "  ",
      legacyCsv: LEGACY_MONTHLY,
    });
    expect([...set]).toEqual([LEGACY_MONTHLY]);
  });
});

describe("isRecognizedSummittPriceId", () => {
  const recognized = getRecognizedSummittPriceIds({
    monthly: NEW_MONTHLY,
    annual: NEW_ANNUAL,
    legacyCsv: `${LEGACY_MONTHLY},${LEGACY_ANNUAL}`,
  });

  it("recognizes current and legacy IDs", () => {
    expect(isRecognizedSummittPriceId(NEW_MONTHLY, recognized)).toBe(true);
    expect(isRecognizedSummittPriceId(NEW_ANNUAL, recognized)).toBe(true);
    expect(isRecognizedSummittPriceId(LEGACY_MONTHLY, recognized)).toBe(true);
    expect(isRecognizedSummittPriceId(LEGACY_ANNUAL, recognized)).toBe(true);
  });

  it("rejects unrelated Price IDs", () => {
    expect(
      isRecognizedSummittPriceId("price_unrelated_other_product", recognized)
    ).toBe(false);
    expect(isRecognizedSummittPriceId(undefined, recognized)).toBe(false);
    expect(isRecognizedSummittPriceId("", recognized)).toBe(false);
  });
});

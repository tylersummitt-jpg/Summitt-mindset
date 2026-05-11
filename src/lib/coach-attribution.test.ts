import { describe, expect, it } from "vitest";
import {
  COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
  isCoachAttributionPath,
  maySetCoachAcquisitionSource,
  shouldSyncCoachAttribution,
} from "@/lib/coach-attribution";

describe("coach attribution", () => {
  it("matches coach leadership kit root", () => {
    expect(isCoachAttributionPath("/coach-leadership-kit")).toBe(true);
  });

  it("matches coach leadership kit trailing slash", () => {
    expect(isCoachAttributionPath("/coach-leadership-kit/")).toBe(true);
  });

  it("matches nested coach leadership kit routes", () => {
    expect(isCoachAttributionPath("/coach-leadership-kit/how-it-works")).toBe(true);
  });

  it("matches nested coach leadership kit routes with trailing slash", () => {
    expect(isCoachAttributionPath("/coach-leadership-kit/how-it-works/")).toBe(true);
  });

  it("does not match non-coach routes", () => {
    expect(isCoachAttributionPath("/")).toBe(false);
    expect(isCoachAttributionPath("/guide")).toBe(false);
    expect(isCoachAttributionPath("/coach")).toBe(false);
    expect(isCoachAttributionPath("/coach-leadership-kitXYZ")).toBe(false);
  });

  it("syncs when acquisitionSource missing and cookie is coach", () => {
    expect(
      shouldSyncCoachAttribution({
        acquisitionSource: undefined,
        attributionCookieValue: COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
      })
    ).toBe(true);
  });

  it("does not sync when acquisitionSource already coach", () => {
    expect(
      shouldSyncCoachAttribution({
        acquisitionSource: "coach",
        attributionCookieValue: COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
      })
    ).toBe(false);
  });

  it("does not sync when acquisitionSource is another non-empty value", () => {
    expect(
      shouldSyncCoachAttribution({
        acquisitionSource: "other",
        attributionCookieValue: COACH_ATTRIBUTION_COOKIE_VALUE_COACH,
      })
    ).toBe(false);
  });

  it("does not sync when coach cookie is missing", () => {
    expect(
      shouldSyncCoachAttribution({
        acquisitionSource: undefined,
        attributionCookieValue: null,
      })
    ).toBe(false);
  });

  describe("maySetCoachAcquisitionSource", () => {
    it("allows undefined", () => {
      expect(maySetCoachAcquisitionSource(undefined)).toBe(true);
    });

    it("allows null", () => {
      expect(maySetCoachAcquisitionSource(null)).toBe(true);
    });

    it("allows empty string", () => {
      expect(maySetCoachAcquisitionSource("")).toBe(true);
    });

    it("allows whitespace-only string", () => {
      expect(maySetCoachAcquisitionSource("   ")).toBe(true);
    });

    it("disallows coach", () => {
      expect(maySetCoachAcquisitionSource("coach")).toBe(false);
    });

    it("disallows partner", () => {
      expect(maySetCoachAcquisitionSource("partner")).toBe(false);
    });

    it("disallows facebook", () => {
      expect(maySetCoachAcquisitionSource("facebook")).toBe(false);
    });

    it("disallows non-string types", () => {
      expect(maySetCoachAcquisitionSource({})).toBe(false);
      expect(maySetCoachAcquisitionSource([])).toBe(false);
      expect(maySetCoachAcquisitionSource(0)).toBe(false);
    });
  });
});


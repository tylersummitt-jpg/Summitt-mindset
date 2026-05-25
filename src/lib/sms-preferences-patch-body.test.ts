import { describe, expect, it } from "vitest";

import {
  buildSmsPreferencesPatchBody,
  SMS_PREFS_STOPPED_COPY,
  type SmsPreferencesEditBaseline,
  type SmsPreferencesEditFormState,
} from "@/lib/sms-preferences-patch-body";

const baseline: SmsPreferencesEditBaseline = {
  cadenceOverride: "every_other_day",
  weekendSendPolicy: "all",
  pauseUntilLocal: "",
  pauseReasonCategory: "pause_request",
};

function form(over: Partial<SmsPreferencesEditFormState>): SmsPreferencesEditFormState {
  return { ...baseline, clearPause: false, ...over };
}

describe("buildSmsPreferencesPatchBody", () => {
  it("returns null when nothing changed", () => {
    expect(buildSmsPreferencesPatchBody(baseline, form({}))).toBeNull();
  });

  it("does not clear cadence when only weekend changes", () => {
    const body = buildSmsPreferencesPatchBody(
      baseline,
      form({ weekendSendPolicy: "weekdays_only" })
    );
    expect(body).toEqual({ weekend_send_policy: "weekdays_only" });
    expect(body).not.toHaveProperty("clearCadenceOverride");
    expect(body).not.toHaveProperty("cadence_override");
  });

  it("clears cadence only when user changes cadence to default rhythm", () => {
    const body = buildSmsPreferencesPatchBody(baseline, form({ cadenceOverride: "" }));
    expect(body).toEqual({ clearCadenceOverride: true });
  });

  it("sets cadence override when user changes to every_3_days", () => {
    const body = buildSmsPreferencesPatchBody(
      baseline,
      form({ cadenceOverride: "every_3_days" })
    );
    expect(body).toEqual({ cadence_override: "every_3_days" });
  });

  it("does not include cadence fields when cadence unchanged at default", () => {
    const defaultBaseline: SmsPreferencesEditBaseline = {
      ...baseline,
      cadenceOverride: "",
    };
    const body = buildSmsPreferencesPatchBody(
      defaultBaseline,
      form({ cadenceOverride: "", weekendSendPolicy: "weekdays_only" })
    );
    expect(body).toEqual({ weekend_send_policy: "weekdays_only" });
    expect(body).not.toHaveProperty("clearCadenceOverride");
  });

  it("sends clearPause only when user explicitly clears an active pause", () => {
    const pausedBaseline: SmsPreferencesEditBaseline = {
      ...baseline,
      pauseUntilLocal: "2026-06-01",
      pauseReasonCategory: "vacation",
    };
    const body = buildSmsPreferencesPatchBody(
      pausedBaseline,
      form({ clearPause: true, pauseUntilLocal: "" })
    );
    expect(body).toEqual({ clearPause: true });
  });

  it("does not send clearPause when there was no active pause", () => {
    const body = buildSmsPreferencesPatchBody(
      baseline,
      form({ clearPause: true, weekendSendPolicy: "weekdays_only" })
    );
    expect(body).toEqual({ weekend_send_policy: "weekdays_only" });
    expect(body).not.toHaveProperty("clearPause");
  });

  it("sends pause_until when user sets a new pause date", () => {
    const body = buildSmsPreferencesPatchBody(
      baseline,
      form({ pauseUntilLocal: "2026-06-15", pauseReasonCategory: "travel" })
    );
    expect(body?.pause_until).toBe(new Date("2026-06-15T23:59:59").toISOString());
    expect(body?.pause_reason_category).toBe("travel");
  });
});

describe("SMS_PREFS_STOPPED_COPY", () => {
  it("uses rhythm language, not timing", () => {
    expect(SMS_PREFS_STOPPED_COPY).toContain("adjust rhythm");
    expect(SMS_PREFS_STOPPED_COPY.toLowerCase()).not.toContain("timing");
  });
});

describe("text-check-ins-section source", () => {
  it("omits timing display and legacy Time row", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/components/text-check-ins-section.tsx", "utf8");
    expect(src).not.toContain("effectiveTimingLabel");
    expect(src).not.toContain("SMS_PREFS_LEARNED_TIMING");
    expect(src).not.toContain("When Pat texts");
    expect(src).not.toContain('text-gray-600">Time</span>');
    expect(src).toContain("SMS_PREFS_STOPPED_COPY");
  });
});

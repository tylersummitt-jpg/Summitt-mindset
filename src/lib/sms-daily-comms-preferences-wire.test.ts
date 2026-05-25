import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms — comms preferences wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports and fetches comms prefs", () => {
    expect(src).toContain("fetchV2UserSmsCommsPreferences");
    expect(src).toContain("shouldSkipDailyForCommsPrefs");
    expect(src).toContain("resolveDailySendWindowPolicy");
  });

  it("pause skip happens before reserveTodaySendOrSkip", () => {
    const pauseIdx = src.indexOf("stats.skippedUserPause += 1");
    const reserveIdx = src.indexOf("const reservation = await reserveTodaySendOrSkip");
    expect(pauseIdx).toBeGreaterThanOrEqual(0);
    expect(reserveIdx).toBeGreaterThan(pauseIdx);
  });

  it("weekend skip happens before reserve", () => {
    const wkIdx = src.indexOf("stats.skippedUserWeekendPolicy += 1");
    const reserveIdx = src.indexOf("const reservation = await reserveTodaySendOrSkip");
    expect(wkIdx).toBeGreaterThanOrEqual(0);
    expect(reserveIdx).toBeGreaterThan(wkIdx);
  });

  it("shouldEnterLowPressureReactivation gated during pause", () => {
    expect(src).toContain("!isPauseActive(commsPrefs");
    expect(src).toContain("shouldEnterLowPressureReactivation");
  });

  it("preferred hour/window before learned gate in send window block", () => {
    expect(src).toContain("sendWindowPolicy.useExplicitHour");
    expect(src).toContain("sendWindowPolicy.useExplicitWindow");
  });

  it("cadence_override can apply for expected daily users", () => {
    expect(src).toContain("userCadenceOverride");
    expect(src).toContain("!isExpectedDailyAttemptUser || userCadenceOverride != null");
  });

  it("does not add skipped_user_pause sms_send_events status", () => {
    expect(src).not.toContain("skipped_user_pause");
  });
});

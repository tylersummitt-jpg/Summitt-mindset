import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms — comms preferences wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports and fetches comms prefs for pause/weekend/cadence", () => {
    expect(src).toContain("fetchV2UserSmsCommsPreferences");
    expect(src).toContain("shouldSkipDailyForCommsPrefs");
    expect(src).toContain("shouldApplyUserCadenceOverride");
  });

  it("does not use adaptive send-window policy for Morning timing", () => {
    expect(src).not.toContain("resolveDailySendWindowPolicy");
    expect(src).not.toContain("sendWindowPolicy.useExplicitHour");
    expect(src).not.toContain("fetchV2UserSendTimeProfile");
    expect(src).toContain("evaluateMorningLaneTiming");
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

  it("Morning fixed window gate happens before reserve", () => {
    const windowIdx = src.indexOf("evaluateMorningLaneTiming");
    const reserveIdx = src.indexOf("const reservation = await reserveTodaySendOrSkip");
    expect(windowIdx).toBeGreaterThanOrEqual(0);
    expect(reserveIdx).toBeGreaterThan(windowIdx);
  });

  it("cadence_override still applies via shouldApplyUserCadenceOverride", () => {
    expect(src).toContain("userCadenceOverride");
    expect(src).toContain("shouldApplyUserCadenceOverride");
    expect(src).toContain("shouldSendV2CadenceToday");
  });

  it("does not add skipped_user_pause sms_send_events status", () => {
    expect(src).not.toContain("skipped_user_pause");
  });
});

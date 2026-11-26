import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms — comms preferences wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports and fetches comms prefs for pause/weekend/cadence", () => {
    const sender = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-send.ts"),
      "utf8"
    );
    const schedule = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-proactive-schedule.ts"),
      "utf8"
    );
    expect(sender).toContain("readV2UserSmsCommsPreferences");
    expect(sender).toContain("cadenceDecisionForMemberDate");
    expect(schedule).toContain("pause_indefinite");
    expect(schedule).toContain("weekend_policy");
    expect(schedule).toContain('"cadence"');
  });

  it("does not use adaptive send-window policy for Morning timing", () => {
    const production = src.slice(src.indexOf("export async function GET"));
    expect(production).not.toContain("resolveDailySendWindowPolicy");
    expect(production).not.toContain("sendWindowPolicy.useExplicitHour");
    expect(production).not.toContain("fetchV2UserSendTimeProfile");
    expect(production).not.toContain("evaluateMorningLaneTiming");
    expect(production).toContain("deliverScheduledDailyCoaching");
  });

  it("pause skip happens before reserveTodaySendOrSkip", () => {
    const schedule = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-proactive-schedule.ts"),
      "utf8"
    );
    const pause = schedule.indexOf('return unscheduled("pause_indefinite"');
    const weekend = schedule.indexOf('return unscheduled("weekend_policy"');
    expect(pause).toBeGreaterThan(-1);
    expect(weekend).toBeGreaterThan(pause);
    const production = src.slice(src.indexOf("export async function GET"));
    expect(production).toContain('scheduledDelivery.reason === "pause_indefinite"');
    expect(production).not.toContain("reserveTodaySendOrSkip(");
  });

  it("weekend skip happens before reserve", () => {
    const schedule = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-proactive-schedule.ts"),
      "utf8"
    );
    const weekend = schedule.indexOf('return unscheduled("weekend_policy"');
    expect(weekend).toBeGreaterThan(-1);
    const sender = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-send.ts"),
      "utf8"
    );
    const prepare = sender.slice(sender.indexOf("async function prepareScheduledDailyDelivery"));
    expect(prepare.indexOf("resolveProactiveSchedule")).toBeLessThan(
      prepare.indexOf('rpc("tto_reserve_scheduled_daily_delivery"')
    );
  });

  it("Morning fixed window gate happens before reserve", () => {
    const sender = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-send.ts"),
      "utf8"
    );
    const prepare = sender.slice(sender.indexOf("async function prepareScheduledDailyDelivery"));
    const grace = prepare.indexOf("evaluateScheduledDeliveryGrace");
    const reserve = prepare.indexOf('rpc("tto_reserve_scheduled_daily_delivery"');
    expect(grace).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(grace);
    expect(prepare).not.toContain("evaluateMorningLaneTiming");
  });

  it("cadence_override still applies via shouldApplyUserCadenceOverride", () => {
    const scheduled = fs.readFileSync(
      path.join(process.cwd(), "src/lib/tto-scheduled-generate.ts"),
      "utf8"
    );
    expect(scheduled).toContain("cadence_override");
    expect(scheduled).toContain("shouldSendV2CadenceToday");
    const schedule = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-proactive-schedule.ts"),
      "utf8"
    );
    expect(schedule).toContain('return unscheduled("cadence"');
  });

  it("does not add skipped_user_pause sms_send_events status", () => {
    expect(src).not.toContain("skipped_user_pause");
  });
});

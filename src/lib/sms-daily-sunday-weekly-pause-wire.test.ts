import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const HELPER = path.join(process.cwd(), "src/lib/sms-sunday-weekly-pause-eligibility.ts");

describe("daily-sms — Sunday weekly pause suppression wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const helperSrc = fs.readFileSync(HELPER, "utf8");

  it("imports Sunday weekly pause eligibility helpers", () => {
    expect(src).toContain("isSundayWeeklyPatPauseEligible");
    expect(src).toContain("shouldSuppressDailyForSundayWeeklyPause");
    expect(src).toContain("buildSundayWeeklyPauseSkipMetadata");
    expect(src).toContain("SUNDAY_WEEKLY_PAUSE_SKIP_STATUS");
  });

  it("writes skipped_sunday_weekly_pause before Twilio on main and retry paths", () => {
    expect(src).toContain("applySundayWeeklyPauseSuppressionIfNeeded");
    const helperIdx = src.indexOf("async function applySundayWeeklyPauseSuppressionIfNeeded");
    expect(helperIdx).toBeGreaterThanOrEqual(0);
    const twilioIdx = src.indexOf("await sendSMS(");
    expect(twilioIdx).toBeGreaterThan(helperIdx);

    const mainSlice = src.slice(src.indexOf('stage = "build_content"'), twilioIdx);
    expect(mainSlice).toContain("applySundayWeeklyPauseSuppressionIfNeeded");
    expect(mainSlice).toContain("skippedSundayWeeklyPause");

    const retrySlice = src.slice(
      src.indexOf('if (existingEvent.status === "send_failed")'),
      src.indexOf('stage = "v2_cadence_gate"')
    );
    expect(retrySlice).toContain("applySundayWeeklyPauseSuppressionIfNeeded");
  });

  it("skip metadata includes observability fields and no Twilio in suppression branch", () => {
    expect(helperSrc).toContain("suppressed_daily_before_weekly");
    expect(helperSrc).toContain("weekly_expected_send_window");
    expect(helperSrc).toContain("would_have_route_kind");
    expect(src).toContain("buildSundayWeeklyPauseSkipMetadata");
    const helperBlock = src.slice(
      src.indexOf("async function applySundayWeeklyPauseSuppressionIfNeeded"),
      src.indexOf("async function reserveTodaySendOrSkip")
    );
    expect(helperBlock).toContain("buildSundayWeeklyPauseSkipMetadata");
    expect(helperBlock).not.toContain("sendSMS");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const SEND = path.join(process.cwd(), "src/lib/tyler-text-overview-send.ts");
const SCHEDULED = path.join(process.cwd(), "src/lib/tto-scheduled-generate.ts");
const GENERATE = path.join(process.cwd(), "src/lib/tyler-text-overview-generate.ts");

describe("scheduled daily coaching does not suppress Sunday for retired Weekly", () => {
  const route = fs.readFileSync(ROUTE, "utf8");
  const send = fs.readFileSync(SEND, "utf8");
  const scheduled = fs.readFileSync(SCHEDULED, "utf8");
  const generate = fs.readFileSync(GENERATE, "utf8");

  it("does not call the old Sunday weekly pause from the live paths", () => {
    for (const src of [route, send, scheduled, generate]) {
      expect(src).not.toContain("shouldSuppressDailyForSundayWeeklyPause");
      expect(src).not.toContain("applySundayWeeklyPauseBeforeWriterIfNeeded");
      expect(src).not.toContain("applySundayWeeklyPauseSuppressionIfNeeded");
      expect(src).not.toContain("skippedSundayWeeklyPause");
      expect(src).not.toContain("SMS_SUNDAY_SUPPRESS_DAILY_FOR_WEEKLY");
    }
  });

  it("Sunday eligibility stays on the shared schedule resolver", () => {
    expect(scheduled).toContain("resolveProactiveSchedule");
    expect(send).toContain("resolveProactiveSchedule");
    expect(generate).toContain("attachSundayCoachingContext");
  });
});

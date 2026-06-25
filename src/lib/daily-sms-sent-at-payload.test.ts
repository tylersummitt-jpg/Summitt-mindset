import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms Twilio success sms_send_events payload", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");

  it("persists sent_at on main and retry success updates via shared helper", () => {
    expect(src).toContain("function dailySmsTwilioSuccessSendEventFields");
    expect(src).toContain("sent_at: sentAtIso");
    expect(src).toMatch(/metadata:\s*\{[\s\S]*sent_at:\s*sentAtIso/);
    expect(src).toContain("twilio_send_attempted: true");
    expect(src).toContain("dailySmsTwilioSuccessSendEventFields({");
    expect(src).toContain("mainSuccessPayload = dailySmsTwilioSuccessSendEventFields");
    expect(src).toContain("retrySuccessPayload = dailySmsTwilioSuccessSendEventFields");
  });

  it("does not alter Twilio sendSMS call surface", () => {
    const sendSmsIdx = src.indexOf("sendSMS(");
    expect(sendSmsIdx).toBeGreaterThan(-1);
    const twilioSuccessRegion = src.slice(sendSmsIdx, sendSmsIdx + 4000);
    expect(twilioSuccessRegion).not.toMatch(/sendSMS\([^)]*sent_at/);
  });

  it("keeps sms_body on success payload without changing body assignment", () => {
    expect(src).toMatch(/sms_body:\s*args\.smsBody/);
    expect(src).toMatch(/smsBody,\s*\n\s*metadata:/);
  });
});

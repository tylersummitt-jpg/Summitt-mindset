import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");

describe("daily-sms Twilio success sms_send_events payload", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");

  it("does not write top-level sent_at on success payload", () => {
    const helperStart = src.indexOf("function dailySmsTwilioSuccessSendEventFields");
    expect(helperStart).toBeGreaterThan(-1);
    const returnStart = src.indexOf("return {", helperStart);
    const returnEnd = src.indexOf("};", returnStart);
    const returnBlock = src.slice(returnStart, returnEnd);
    expect(returnBlock).toMatch(/sms_body:\s*args\.smsBody,\s*\n\s*metadata:/);
    expect(returnBlock).toMatch(/sent_at:\s*sentAtIso/);
  });

  it("persists metadata.sent_at, twilio_message_sid, and visible body on success", () => {
    expect(src).toContain("function dailySmsTwilioSuccessSendEventFields");
    expect(src).toContain("twilio_message_sid: args.messageSid");
    expect(src).toContain("final_sms_body: args.smsBody");
    expect(src).toContain("twilio_status: args.twilioStatus");
    expect(src).toContain("twilio_send_attempted: true");
    expect(src).toContain("mainSuccessPayload = dailySmsTwilioSuccessSendEventFields");
    expect(src).toContain("retrySuccessPayload = dailySmsTwilioSuccessSendEventFields");
  });

  it("keeps message_sid, status, and sms_body at top level", () => {
    expect(src).toMatch(/message_sid:\s*args\.messageSid/);
    expect(src).toMatch(/status:\s*args\.twilioStatus/);
    expect(src).toMatch(/sms_body:\s*args\.smsBody/);
  });

  it("does not alter Twilio sendSMS call surface", () => {
    const sendSmsIdx = src.indexOf("sendSMS(");
    expect(sendSmsIdx).toBeGreaterThan(-1);
    const twilioSuccessRegion = src.slice(sendSmsIdx, sendSmsIdx + 4000);
    expect(twilioSuccessRegion).not.toMatch(/sendSMS\([^)]*sent_at/);
  });

  it("records Twilio success via fallback helper after primary DB failure", () => {
    expect(src).toContain("function recordDailyTwilioSuccessOrFallback");
    expect(src).toContain("twilio_db_primary_update_failed: true");
    expect(src).toContain("note: \"sent_to_twilio_db_update_recovered\"");
    expect(src).toContain("CRITICAL orphan Twilio send");
  });

  it("treats metadata Twilio SID as non-retryable via hasAnyTwilioSidOnSendEvent", () => {
    expect(src).toContain("function hasAnyTwilioSidOnSendEvent");
    expect(src).toContain("twilio_message_sid");
    expect(src).toContain("outbound_message_sid");
    expect(src).toMatch(/hasAnyTwilioSidOnSendEvent\(existingEvent\)/);
    expect(src).toMatch(
      /existingEvent\.status === "send_failed"[\s\S]*if \(hasMessageSid\)/
    );
  });

  it("send_failed row with metadata.twilio_message_sid is not retried (guard before retry_count)", () => {
    const sendFailedIdx = src.indexOf('if (existingEvent.status === "send_failed")');
    expect(sendFailedIdx).toBeGreaterThan(-1);
    const block = src.slice(sendFailedIdx, sendFailedIdx + 600);
    expect(block).toContain("if (hasMessageSid)");
    expect(block).toContain("alreadyReservedOrSentToday");
    expect(block.indexOf("if (hasMessageSid)")).toBeLessThan(block.indexOf("retryCount"));
  });

  it("reserved recovery skips rows that already have a Twilio SID in metadata", () => {
    expect(src).toMatch(
      /existingEvent\.status === "reserved" && !hasMessageSid/
    );
  });
});

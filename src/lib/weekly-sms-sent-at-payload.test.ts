import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");
const SEND_PATH = join(process.cwd(), "src/lib/tyler-text-overview-weekly-send.ts");

describe("weekly-sms TTO cutover — event / dryRun / force contracts", () => {
  const route = readFileSync(ROUTE_PATH, "utf8");
  const send = readFileSync(SEND_PATH, "utf8");

  it("the cron refuses before any provider submission", () => {
    expect(route).toContain("weekly_delivery_retired");
    expect(route).toContain("force_ignored");
    expect(route).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(route).not.toMatch(/\bsendSMS\s*\(/);
    const sendFn = send.slice(send.indexOf("export async function sendWeeklyTtoDraftAuthoritative"));
    expect(sendFn).toContain("weekly_delivery_retired");
    expect(sendFn).not.toContain("await sendSMS(");
    expect(sendFn).not.toContain("sms_weekly_send_events");
  });

  it("the retired send functions do not write a sent weekly body", () => {
    const sendFn = send.slice(send.indexOf("export async function sendWeeklyTtoDraftAuthoritative"));
    expect(sendFn).not.toContain("sms_body:");
    expect(sendFn).not.toContain("body_without_footer:");
    expect(sendFn).not.toContain("sent_at:");
    expect(sendFn).not.toContain("message_sid:");
    expect(sendFn).not.toContain("twilioMessageSid");
  });

  it("the retired cron does not reserve, dry-run, or count a weekly send", () => {
    expect(route).not.toContain("sms_weekly_send_events");
    expect(route).not.toContain("if (dryRun)");
    expect(route).not.toContain("skippedDuplicateWeeklySend");
    expect(route).toContain("force_ignored");
    expect(route).not.toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(send).toContain("duplicate_weekly_send");
  });
});

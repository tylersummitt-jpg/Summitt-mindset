import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");
const SEND_PATH = join(process.cwd(), "src/lib/tyler-text-overview-weekly-send.ts");

describe("weekly-sms TTO cutover — event / dryRun / force contracts", () => {
  const route = readFileSync(ROUTE_PATH, "utf8");
  const send = readFileSync(SEND_PATH, "utf8");

  it("real send path goes through shared authoritative send (not route-local sendSMS)", () => {
    expect(route).toContain("sendWeeklyTtoDraftAuthoritative");
    expect(route).not.toMatch(/\bsendSMS\s*\(/);
    expect(send).toMatch(/\bsendSMS\s*\(/);
  });

  it("shared success metadata includes sms_body, body_without_footer, sent_at, send_source", () => {
    expect(send).toContain("sms_body: finalBody");
    expect(send).toContain("body_without_footer: bodyWithoutFooter");
    expect(send).toContain("sent_at: sentAtIso");
    expect(send).toContain("send_source: args.sendSource");
    expect(send).toContain("message_sid: twilioMessageSid");
  });

  it("dryRun never reserves sms_weekly_send_events in the route", () => {
    const dryStart = route.indexOf("if (dryRun)");
    const afterDry = route.indexOf("if (!isTwilioReady())", dryStart);
    expect(dryStart).toBeGreaterThanOrEqual(0);
    expect(afterDry).toBeGreaterThan(dryStart);
    expect(route.slice(dryStart, afterDry)).not.toContain("sms_weekly_send_events");
  });

  it("force does not skip TTO authority", () => {
    expect(route).toMatch(/force[\s\S]*assertWeeklyTtoDraftAuthoritativeForCronSend/);
    // After window check, authority always runs for non-dry and dry paths
    expect(route).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
  });

  it("duplicate weekly events are counted via refusal mapping", () => {
    expect(route).toContain("skippedDuplicateWeeklySend");
    expect(route).toContain("skippedV2WeeklyDuplicate");
    expect(send).toContain("duplicate_weekly_send");
  });

  it("does not write sent_at on dryRun path in route", () => {
    const dryStart = route.indexOf("if (dryRun)");
    const afterDry = route.indexOf("if (!isTwilioReady())", dryStart);
    expect(route.slice(dryStart, afterDry)).not.toMatch(/sent_at/);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");
const SEND = path.join(process.cwd(), "src/lib/tyler-text-overview-weekly-send.ts");
const LENGTH = path.join(process.cwd(), "src/lib/weekly-tto-length.ts");

describe("weekly-sms — comms preferences wire (TTO cutover)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const send = fs.readFileSync(SEND, "utf8");

  it("refuses before preference reads or a weekly send", () => {
    expect(src).toContain("weekly_delivery_retired");
    expect(src).toContain("force_ignored");
    expect(src).not.toContain("fetchV2UserSmsCommsPreferences");
    expect(src).not.toContain("shouldSkipWeeklyForCommsPrefs");
    expect(src).not.toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
  });

  it("live builders are gone from cron; footer lives in shared send core", () => {
    const length = fs.readFileSync(LENGTH, "utf8");
    expect(src).not.toContain("buildV2WeeklyProofPack");
    expect(src).not.toContain("buildWeeklyV3OutboundFactsForV2WeeklyProof");
    expect(send).toContain("WEEKLY_TTO_COMPLIANCE_FOOTER");
    expect(length).toContain("Reply STOP to opt out. Reply HELP for help.");
  });
});

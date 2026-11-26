import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");
const ROUTE = path.join(REPO, "src/app/api/cron/weekly-sms/route.ts");

describe("weekly-sms after TTO cutover — no legacy live-send branch", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("does not retain legacy weekly reflection or deprecated live-send branch", () => {
    expect(src).not.toContain("generateWeeklySmsReflection");
    expect(src).not.toContain("skipped_legacy_weekly_deprecated");
    expect(src).not.toContain("legacy_weekly_branch");
  });

  it("refuses Weekly delivery before any provider submission", () => {
    expect(src).toContain("weekly_delivery_retired");
    expect(src).toContain("force_ignored");
    expect(src).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
    expect(src).not.toContain("buildV2WeeklyProofPack");
    expect(src).not.toContain("sendSMS");
  });
});

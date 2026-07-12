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

  it("non-V2 users are skipped without reserving or sending", () => {
    expect(src).toContain("skippedNotFullyOnV2");
    expect(src).toContain("resolveUserFullyOnV2ForCutoverMessaging");
  });

  it("send path is only Weekly TTO shared core", () => {
    expect(src).toContain("sendWeeklyTtoDraftAuthoritative");
    expect(src).toContain("WEEKLY_TTO_CRON_SEND_SOURCE");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
    expect(src).not.toContain("buildV2WeeklyProofPack");
  });
});

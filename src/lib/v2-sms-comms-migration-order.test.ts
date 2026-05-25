import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

describe("v2_user_sms_comms_preferences migration order", () => {
  it("uses 20260606120000 and not the out-of-order 20260522120000 filename", () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    expect(files).toContain("20260606120000_v2_user_sms_comms_preferences.sql");
    expect(files).not.toContain("20260522120000_v2_user_sms_comms_preferences.sql");
  });

  it("comms prefs migration sorts after latest June 20260605 migration", () => {
    const comms = "20260606120000_v2_user_sms_comms_preferences.sql";
    const june = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.startsWith("202606") && f.endsWith(".sql"))
      .sort();
    const latestBeforeComms = june.filter((f) => f < comms).pop();
    expect(latestBeforeComms).toBe("20260605120000_victory_season_summary_snapshot.sql");
    expect(comms > latestBeforeComms!).toBe(true);
  });
});

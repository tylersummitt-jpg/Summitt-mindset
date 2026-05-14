import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");
const ROUTE = path.join(REPO, "src/app/api/cron/inactivity-rescue/route.ts");

describe("inactivity-rescue — Phase 4.4 deprecated / no-send", () => {
  it("disabled path returns early when INACTIVITY_RESCUE_SMS_ENABLED !== true", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain('process.env.INACTIVITY_RESCUE_SMS_ENABLED !== "true"');
    expect(src).toContain("disabled: true");
    expect(src).toContain("Phase 4.4");
  });

  it("enabled branch does not call sendSMS, refine, North Star, or FVG", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).not.toMatch(/\bsendSMS\s*\(/);
    expect(src).not.toContain("refineMachineSmsBodyWithV3RefineLane");
    expect(src).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(src).not.toContain("applyFinalVoiceOwnershipGate");
    expect(src).not.toContain("createRescueToken");
    expect(src).not.toContain("appendPreservedSignedLink");
    expect(src).not.toContain("isTwilioReady");
  });

  it("records deprecation via feedback moment inactivity_rescue_deprecated with safe message", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("inactivity_rescue_deprecated");
    expect(src).toContain("inactivity rescue deprecated; no SMS sent");
    expect(src).not.toContain("/rescue?t=");
    expect(src).not.toContain("buildRescueLink");
  });

  it("insert metadata includes required Phase 4.4 fields", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("inactivity_rescue_deprecated_use_daily_reactivation");
    expect(src).toContain("twilio_send_attempted: false");
    expect(src).toContain("old_outbound_writer_used_as_voice: false");
    expect(src).toContain("signed_link_generated: false");
    expect(src).toContain("inactivity_rescue_skipped_fully_on_v2_daily_reactivation_canonical");
  });

  it("does not insert feedback with moment inactivity_rescue_sent", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    const insertIdx = src.indexOf(".insert({");
    expect(insertIdx).toBeGreaterThan(0);
    expect(src.slice(insertIdx)).not.toContain('moment: "inactivity_rescue_sent"');
  });

  it("dedupes deprecation rows with prior select on moment inactivity_rescue_deprecated", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain('eq("moment", "inactivity_rescue_deprecated")');
    expect(src).toContain("skippedAlreadyDeprecated");
  });

  it("uses resolveUserFullyOnV2ForCutoverMessaging for observability", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("resolveUserFullyOnV2ForCutoverMessaging");
  });

  it("response stats include deprecation counters", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("deprecatedInactivityRescue");
    expect(src).toContain("skippedFullyOnV2DailyReactivation");
  });
});

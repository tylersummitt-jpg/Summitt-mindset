import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..", "..");
const ROUTE = path.join(REPO, "src/app/api/cron/post-churn-winback/route.ts");

describe("post-churn-winback — Phase 4.5 deprecated / no-send", () => {
  it("does not call sendSMS, refine, North Star, FVG, or signed link helpers", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).not.toMatch(/\bsendSMS\s*\(/);
    expect(src).not.toContain("refineMachineSmsBodyWithV3RefineLane");
    expect(src).not.toContain("finalizeNorthStarCoachSmsAsync");
    expect(src).not.toContain("applyFinalVoiceOwnershipGate");
    expect(src).not.toContain("appendPreservedSignedLink");
    expect(src).not.toContain("createWinbackToken");
    expect(src).not.toContain("/winback?t=");
    expect(src).not.toContain("buildWinbackLink");
  });

  it("does not contain hard-coded winback product question body", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).not.toContain("rebuilt ONE thing");
    expect(src).not.toContain("One last question");
  });

  it("records deprecation via post_churn_winback_deprecated with safe message", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("post_churn_winback_deprecated");
    expect(src).toContain("post-churn winback deprecated; no SMS sent");
  });

  it("insert metadata includes required Phase 4.5 fields", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("post_churn_winback_deprecated_no_sms");
    expect(src).toContain("twilio_send_attempted: false");
    expect(src).toContain("old_outbound_writer_used_as_voice: false");
    expect(src).toContain("signed_link_generated: false");
    expect(src).toContain("signed_url_stored: false");
  });

  it("does not insert post_churn_winback_sent moment", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    const insertIdx = src.indexOf(".insert({");
    expect(insertIdx).toBeGreaterThan(0);
    expect(src.slice(insertIdx)).not.toContain('moment: "post_churn_winback_sent"');
  });

  it("dedupes deprecation with select on post_churn_winback_deprecated", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain('eq("moment", "post_churn_winback_deprecated")');
    expect(src).toContain("skippedAlreadyDeprecated");
  });

  it("preserves post_churn_winback_sent latch select", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain('eq("moment", "post_churn_winback_sent")');
    expect(src).toContain("skippedAlreadySent");
  });

  it("cancel query selects id for source_cancel_event_id metadata", () => {
    const src = fs.readFileSync(ROUTE, "utf8");
    expect(src).toContain("source_cancel_event_id");
    expect(src).toContain("cancel_event_created_at");
    expect(src).toContain("id, clerk_user_id, created_at");
  });
});

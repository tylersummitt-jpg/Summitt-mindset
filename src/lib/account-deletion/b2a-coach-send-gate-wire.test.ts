import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COACH = path.join(
  process.cwd(),
  "src/app/api/cron/sms-inbound-coach/route.ts"
);
const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260718130000_account_deletion_sms_suppress.sql"
);

describe("APP-041B2a final pre-send gate (wire)", () => {
  const src = fs.readFileSync(COACH, "utf8");
  const sql = fs.readFileSync(MIGRATION, "utf8");

  const sendFnStart = src.indexOf(
    "async function commitAndSendInboundCoachReply"
  );
  const sendFnEnd = src.indexOf("\nasync function ", sendFnStart + 1);
  const sendBlock = src.slice(
    sendFnStart,
    sendFnEnd > sendFnStart ? sendFnEnd : sendFnStart + 8000
  );

  it("uses shared eligibility helper immediately before Twilio", () => {
    expect(src).toContain(
      'from "@/lib/account-deletion/inbound-coach-send-eligibility"'
    );
    expect(src).toContain("checkInboundCoachSmsEligibility");

    const twilioIdx = sendBlock.indexOf("await sendSMSChunked");
    expect(twilioIdx).toBeGreaterThan(0);
    const beforeTwilio = sendBlock.slice(0, twilioIdx);
    expect(beforeTwilio).toContain("checkInboundCoachSmsEligibility");
    expect(beforeTwilio).toContain("eligibility.lastErrorCode");
    expect(beforeTwilio).toContain('status: "cancelled"');
  });

  it("does not throw a retry after eligibility cancel", () => {
    const eligFail = sendBlock.indexOf("if (!eligibility.ok)");
    expect(eligFail).toBeGreaterThan(0);
    const after = sendBlock.slice(eligFail, eligFail + 280);
    expect(after).toContain("return;");
    expect(after).not.toContain("throw ");
  });

  it("treats cancelled claim-loss as non-send (no Twilio)", () => {
    const claimBlock = sendBlock.slice(
      sendBlock.indexOf("if (!sendClaim)"),
      sendBlock.indexOf("if (!isTwilioReady())")
    );
    expect(claimBlock).toContain('j.status === "cancelled"');
    expect(claimBlock).toContain("return;");
  });

  it("suppression SQL cancels nonterminal jobs and writes atomic marker", () => {
    expect(sql).toContain("AND status NOT IN ('sent', 'cancelled')");
    expect(sql).toContain("'sms_binding_removed'");
    expect(sql).toContain("current_step IS DISTINCT FROM 'suppressing_sms'");
  });
});

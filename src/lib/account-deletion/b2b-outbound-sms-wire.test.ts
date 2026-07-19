import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

describe("APP-041B2b path hardening wire", () => {
  it("daily self-heal evaluates deletion before push", () => {
    const src = read("src/app/api/cron/daily-sms/route.ts");
    expect(src).toContain("evaluateOutboundSmsForAccountDeletion");
    expect(src).toContain("never heal/push deleting users");
    expect(src).toContain("reservedSendEventPatchForDeletionError");
    expect(src).toContain("isAccountDeletionOutboundSmsError");
  });

  it("weekly authoritative send has deletion refusal codes", () => {
    const src = read("src/lib/tyler-text-overview-weekly-send.ts");
    expect(src).toContain("account_deletion_blocks_sms");
    expect(src).toContain("deletion_lookup_failed");
    expect(src).toContain("evaluateOutboundSmsForAccountDeletion");
  });

  it("evening eligibility and send catch deletion", () => {
    const src = read("src/lib/tyler-text-overview-evening-send.ts");
    expect(src).toContain("account_deletion_blocks_sms");
    expect(src).toContain("evaluateOutboundSmsForAccountDeletion");
    expect(src).toContain("isAccountDeletionOutboundSmsError");
  });

  it("guided shrink has early and pre-send deletion checks", () => {
    const src = read("src/lib/v2-adaptive-contract.ts");
    expect(src).toContain("early deletion check before expensive generation");
    expect(src).toContain("account_deletion_blocks_sms");
    expect(src).toContain("isAccountDeletionOutboundSmsError");
  });

  it("onboarding has second pre-send deletion check", () => {
    const src = read("src/app/api/onboarding/sms/route.ts");
    expect(src).toContain("second check after identity/phone work");
    expect(src).toContain("evaluateOutboundSmsForAccountDeletion");
    expect(src).toContain("isAccountDeletionOutboundSmsError");
  });

  it("inbound coach maps transport deletion to cancelled terminal", () => {
    const src = read("src/app/api/cron/sms-inbound-coach/route.ts");
    expect(src).toContain("dispositionInboundCoachDeletionSendError");
    expect(src).toContain("retryable_rethrow");
    expect(src).toContain("send cancelled (account deletion)");
    expect(src).toContain("send deferred (deletion_lookup_failed)");
  });

  it("daily/weekly/evening use reservedSendEventPatchForDeletionError", () => {
    expect(read("src/app/api/cron/daily-sms/route.ts")).toContain(
      "reservedSendEventPatchForDeletionError"
    );
    expect(read("src/lib/tyler-text-overview-weekly-send.ts")).toContain(
      "reservedSendEventPatchForDeletionError"
    );
    expect(read("src/lib/tyler-text-overview-evening-send.ts")).toContain(
      "reservedSendEventPatchForDeletionError"
    );
  });

  it("35. messages.create remains only in twilio transport", () => {
    const twilio = read("src/lib/twilio.ts");
    expect(twilio).toContain("messages.create");
    expect(twilio).toContain("assertOutboundSmsAllowedForAccountDeletion");

    const allowlist = [
      "src/app/api/cron/daily-sms/route.ts",
      "src/app/api/cron/sms-inbound-coach/route.ts",
      "src/lib/tyler-text-overview-weekly-send.ts",
      "src/lib/tyler-text-overview-evening-send.ts",
      "src/app/api/onboarding/sms/route.ts",
      "src/lib/v2-adaptive-contract.ts",
    ];
    for (const rel of allowlist) {
      expect(read(rel)).not.toMatch(/messages\.create\s*\(/);
    }
  });
});

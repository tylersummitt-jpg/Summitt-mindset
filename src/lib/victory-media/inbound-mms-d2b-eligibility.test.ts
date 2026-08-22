import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { checkInboundMmsD2bSmsEligibility } from "@/lib/victory-media/inbound-mms-d2b-eligibility";

const USER = "user_d2b_elig";
const PHONE = "+15555550100";

function ident(partial: {
  phone_number?: string | null;
  sms_enabled?: boolean | null;
  stopped_at?: string | null;
} = {}) {
  return {
    phone_number: PHONE,
    sms_enabled: true,
    stopped_at: null,
    ...partial,
  };
}

describe("checkInboundMmsD2bSmsEligibility", () => {
  it("eligible when enabled, not stopped, phone present, deletion clear", async () => {
    const r = await checkInboundMmsD2bSmsEligibility(
      { clerkUserId: USER },
      {
        hasUnresolvedDeletion: async () => false,
        loadIdentity: async () => ident(),
      }
    );
    expect(r).toEqual({ ok: true, reason: "eligible", phone: PHONE });
  });

  it("STOP wins", async () => {
    const r = await checkInboundMmsD2bSmsEligibility(
      { clerkUserId: USER },
      {
        hasUnresolvedDeletion: async () => false,
        loadIdentity: async () =>
          ident({ stopped_at: "2026-08-22T12:05:00.000Z" }),
      }
    );
    expect(r).toEqual({ ok: false, reason: "sms_stopped" });
  });

  it("sms_disabled and missing phone fail closed", async () => {
    expect(
      await checkInboundMmsD2bSmsEligibility(
        { clerkUserId: USER },
        {
          hasUnresolvedDeletion: async () => false,
          loadIdentity: async () => ident({ sms_enabled: false }),
        }
      )
    ).toEqual({ ok: false, reason: "sms_disabled" });
    expect(
      await checkInboundMmsD2bSmsEligibility(
        { clerkUserId: USER },
        {
          hasUnresolvedDeletion: async () => false,
          loadIdentity: async () => ident({ phone_number: "  " }),
        }
      )
    ).toEqual({ ok: false, reason: "phone_missing" });
  });

  it("deletion and lookup failure fail closed", async () => {
    expect(
      await checkInboundMmsD2bSmsEligibility(
        { clerkUserId: USER },
        {
          hasUnresolvedDeletion: async () => true,
          loadIdentity: async () => ident(),
        }
      )
    ).toEqual({ ok: false, reason: "account_deleting" });
    expect(
      await checkInboundMmsD2bSmsEligibility(
        { clerkUserId: USER },
        {
          hasUnresolvedDeletion: async () => {
            throw new Error("db");
          },
          loadIdentity: async () => ident(),
        }
      )
    ).toEqual({ ok: false, reason: "lookup_failed" });
  });

  it("does not require a coach job", () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/lib/victory-media/inbound-mms-d2b-eligibility.ts"
      ),
      "utf8"
    );
    expect(src).not.toContain("sms_inbound_coach_jobs");
  });
});

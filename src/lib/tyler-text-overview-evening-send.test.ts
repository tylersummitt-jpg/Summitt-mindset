import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/twilio", () => ({
  sendSMS: vi.fn(async () => {
    throw new Error("Twilio must not be called while Evening proactive send is disabled");
  }),
  isTwilioReady: vi.fn(() => true),
}));

import {
  EVENING_PROACTIVE_SEND_DISABLED,
  EVENING_PROACTIVE_SEND_DISABLED_CODE,
  EVENING_PROACTIVE_SEND_DISABLED_MESSAGE,
  sendTylerTextOverviewEveningDraft,
} from "@/lib/tyler-text-overview-evening-send";
import { sendSMS } from "@/lib/twilio";

describe("Evening proactive Twilio send disabled", () => {
  it("helper constant marks Evening proactive send disabled", () => {
    expect(EVENING_PROACTIVE_SEND_DISABLED).toBe(true);
  });

  it("sendTylerTextOverviewEveningDraft fails closed without calling Twilio", async () => {
    const result = await sendTylerTextOverviewEveningDraft({
      draftId: "draft-evening-1",
      requestedByClerkUserId: "admin_tyler",
      mode: "manual_one",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusalCode).toBe(EVENING_PROACTIVE_SEND_DISABLED_CODE);
    expect(result.message).toBe(EVENING_PROACTIVE_SEND_DISABLED_MESSAGE);
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("evening-send helper source cannot reach sendSMS after disable gate", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-evening-send.ts"),
      "utf8"
    );
    expect(src).toContain("EVENING_PROACTIVE_SEND_DISABLED");
    expect(src).toContain("evening_proactive_send_disabled");
    // Function returns refuse before any Twilio path.
    const fnStart = src.indexOf("export async function sendTylerTextOverviewEveningDraft");
    const fnBody = src.slice(fnStart, fnStart + 600);
    expect(fnBody).toContain("return refuse(");
    expect(fnBody).toContain("EVENING_PROACTIVE_SEND_DISABLED_CODE");
    expect(fnBody).not.toMatch(/await sendSMS/);
  });

  it("admin evening-send route maps disabled to 410", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/evening-send/route.ts"),
      "utf8"
    );
    expect(src).toContain("evening_proactive_send_disabled");
    expect(src).toMatch(/case "evening_proactive_send_disabled":\s*return 410/);
  });

  it("no Evening cron in vercel.json", () => {
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).not.toMatch(/evening-send|evening_checkin|tyler-text-overview-evening/i);
  });
});

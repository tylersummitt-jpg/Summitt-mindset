import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { notifySmsOptOutReviewNeeded } from "@/lib/notify-sms-opt-out-review";

const HELPER = path.join(process.cwd(), "src/lib/notify-sms-opt-out-review.ts");
const PAT = path.join(process.cwd(), "src/lib/notify-manual-pat-answer.ts");

const ARGS = {
  preferredName: "Susie Smith",
  triggeringText: "Please stop texting me.",
  messageSid: "SMreview",
};

describe("notifySmsOptOutReviewNeeded", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("COACH_KIT_NOTIFY_EMAIL", "ops@example.com");
    vi.stubEnv("COACH_KIT_NOTIFY_FROM", "challenge@summittmindset.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://summittmindset.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the existing sender and does not say the member is unsubscribed", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    await expect(notifySmsOptOutReviewNeeded(ARGS)).resolves.toBeUndefined();
    const payload = sendMock.mock.calls[0]?.[0];
    expect(payload.from).toBe("challenge@summittmindset.com");
    expect(payload.to).toBe("ops@example.com");
    expect(payload.subject).toBe("SMS Opt-Out Review Needed — Susie Smith");
    expect(payload.text).toContain("Please stop texting me.");
    expect(payload.text).toContain("Morning, Evening, and Weekly texts are currently being held.");
    expect(payload.text).toContain(
      "https://summittmindset.com/admin/sms-opt-out-reviews?message_sid=SMreview"
    );
    expect(payload.text.toLowerCase()).not.toContain("unsubscribed");
    expect(payload.html.toLowerCase()).not.toContain("unsubscribed");
    const helper = fs.readFileSync(HELPER, "utf8");
    const pat = fs.readFileSync(PAT, "utf8");
    expect(helper).toContain("process.env.RESEND_API_KEY");
    expect(helper).toContain("process.env.COACH_KIT_NOTIFY_EMAIL");
    expect(helper).toContain("process.env.COACH_KIT_NOTIFY_FROM");
    expect(pat).toContain("process.env.COACH_KIT_NOTIFY_FROM");
  });

  it("does not throw when Resend throws", async () => {
    sendMock.mockRejectedValue(new Error("resend down"));
    await expect(notifySmsOptOutReviewNeeded(ARGS)).resolves.toBeUndefined();
  });
});

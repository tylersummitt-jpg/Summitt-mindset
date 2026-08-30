import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { notifyManualPatAnswerNeeded } from "@/lib/notify-manual-pat-answer";
import fs from "node:fs";
import path from "node:path";

const HELPER = path.join(process.cwd(), "src/lib/notify-manual-pat-answer.ts");

const ARGS = {
  preferredName: "Jane",
  question: "Were you nervous speaking in public?",
  messageSid: "SMmanual1",
  occurredAt: "2026-08-30T11:04:00.000Z",
};

describe("notifyManualPatAnswerNeeded", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("COACH_KIT_NOTIFY_EMAIL", "ops@example.com");
    vi.stubEnv("COACH_KIT_NOTIFY_FROM", "challenge@summittmindset.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends a small internal email and logs sent with provider id", async () => {
    sendMock.mockResolvedValue({ data: { id: "email_abc" }, error: null });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(notifyManualPatAnswerNeeded(ARGS)).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0]?.[0] as {
      to: string;
      from: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(payload.to).toBe("ops@example.com");
    expect(payload.from).toBe("challenge@summittmindset.com");
    expect(payload.subject).toBe("Coach Pat question needs your answer");
    expect(payload.text).toContain("Jane");
    expect(payload.text).toContain("Were you nervous speaking in public?");
    expect(payload.text).toContain("SMmanual1");
    expect(payload.text).toContain("2026-08-30T11:04:00.000Z");
    expect(payload.text).toContain("waiting for a manual Pat answer");
    expect(payload.text).not.toContain("gpt");
    expect(payload.text).not.toContain("embedding");
    expect(payload.text).not.toContain("/admin/");
    expect(info).toHaveBeenCalledWith(
      "[notify-manual-pat-answer] manual_pat_answer_notification_sent",
      { message_sid: "SMmanual1", resend_id: "email_abc" }
    );
  });

  it("fail-soft: Resend throw does not reject", async () => {
    sendMock.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(notifyManualPatAnswerNeeded(ARGS)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
      { message_sid: "SMmanual1", error: "network down" }
    );
  });

  it("fail-soft: Resend error payload does not reject", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "rate limited" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(notifyManualPatAnswerNeeded(ARGS)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed",
      { message_sid: "SMmanual1", error: "rate limited" }
    );
  });

  it("skips send when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(notifyManualPatAnswerNeeded(ARGS)).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toBe(
      "[notify-manual-pat-answer] manual_pat_answer_notification_failed"
    );
  });

  it("reuses COACH_KIT_NOTIFY_EMAIL and does not introduce a new env", async () => {
    const src = fs.readFileSync(HELPER, "utf8");
    expect(src).toContain("process.env.COACH_KIT_NOTIFY_EMAIL");
    expect(src).toContain("process.env.COACH_KIT_NOTIFY_FROM");
    expect(src).toContain("process.env.RESEND_API_KEY");
    expect(src).not.toMatch(/process\.env\.[A-Z0-9_]*MANUAL_PAT/);
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("from(");
  });
});

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { applyInstantly, applyResend } = vi.hoisted(() => ({
  applyInstantly: vi.fn(async () => ({ ok: true as const, duplicate: false })),
  applyResend: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/acquisition/store", () => ({
  applyInstantlyWebhook: (...args: unknown[]) => applyInstantly(...args),
  applyAcquisitionResendEvent: (...args: unknown[]) => applyResend(...args),
}));

import { POST as instantlyPost } from "@/app/api/acquisition/instantly/route";
import { POST as resendPost } from "@/app/api/acquisition/resend/route";

const INSTANTLY_SECRET = "instantly-test-secret";
const RESEND_KEY = Buffer.from("resend-test-secret").toString("base64");

function resendHeaders(body: string, timestampSec: number, signatureBody = body): Headers {
  const signature = createHmac("sha256", Buffer.from(RESEND_KEY, "base64"))
    .update(`msg_acq.${timestampSec}.${signatureBody}`)
    .digest("base64");
  const headers = new Headers();
  headers.set("svix-id", "msg_acq");
  headers.set("svix-timestamp", String(timestampSec));
  headers.set("svix-signature", `v1,${signature}`);
  return headers;
}

afterEach(() => {
  applyInstantly.mockReset();
  applyResend.mockReset();
  applyInstantly.mockResolvedValue({ ok: true, duplicate: false });
  applyResend.mockResolvedValue(undefined);
  delete process.env.INSTANTLY_WEBHOOK_SECRET;
  delete process.env.ACQUISITION_RESEND_WEBHOOK_SECRET;
});

describe("acquisition webhook authentication", () => {
  it("rejects Instantly calls with no secret, a bad header, and accepts one matching custom header", async () => {
    const payload = JSON.stringify({
      event_type: "lead_interested",
      lead_email: "coach@school.edu",
      timestamp: "2026-10-21T16:00:00.000Z",
      email_id: "em_1",
    });
    const missing = await instantlyPost(new Request("https://summittmindset.com/api/acquisition/instantly", {
      method: "POST",
      body: payload,
    }));
    expect(missing.status).toBe(503);
    expect(applyInstantly).not.toHaveBeenCalled();

    process.env.INSTANTLY_WEBHOOK_SECRET = INSTANTLY_SECRET;
    const rejected = await instantlyPost(new Request("https://summittmindset.com/api/acquisition/instantly", {
      method: "POST",
      headers: { "x-instantly-webhook-secret": "wrong" },
      body: payload,
    }));
    expect(rejected.status).toBe(401);
    expect(applyInstantly).not.toHaveBeenCalled();

    const accepted = await instantlyPost(new Request("https://summittmindset.com/api/acquisition/instantly", {
      method: "POST",
      headers: { "x-instantly-webhook-secret": INSTANTLY_SECRET },
      body: payload,
    }));
    expect(accepted.status).toBe(200);
    expect(applyInstantly).toHaveBeenCalledTimes(1);

    applyInstantly.mockResolvedValueOnce({ ok: true, duplicate: true });
    const replay = await instantlyPost(new Request("https://summittmindset.com/api/acquisition/instantly", {
      method: "POST",
      headers: { "x-instantly-webhook-secret": INSTANTLY_SECRET },
      body: payload,
    }));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ ok: true, duplicate: true });
  });

  it("verifies the Resend Svix signature and rejects a bad or stale signature", async () => {
    const now = Date.now();
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "em_delivered" } });
    const missing = await resendPost(new Request("https://summittmindset.com/api/acquisition/resend", {
      method: "POST",
      body,
    }));
    expect(missing.status).toBe(503);
    expect(applyResend).not.toHaveBeenCalled();

    process.env.ACQUISITION_RESEND_WEBHOOK_SECRET = `whsec_${RESEND_KEY}`;
    const validHeaders = resendHeaders(body, Math.floor(now / 1000));
    const accepted = await resendPost(new Request("https://summittmindset.com/api/acquisition/resend", {
      method: "POST",
      headers: validHeaders,
      body,
    }));
    expect(accepted.status).toBe(200);
    expect(applyResend).toHaveBeenCalledWith({ kind: "delivered", providerMessageId: "em_delivered" });

    const invalid = await resendPost(new Request("https://summittmindset.com/api/acquisition/resend", {
      method: "POST",
      headers: resendHeaders(body, Math.floor(now / 1000), `${body} `),
      body,
    }));
    expect(invalid.status).toBe(401);

    const stale = await resendPost(new Request("https://summittmindset.com/api/acquisition/resend", {
      method: "POST",
      headers: resendHeaders(body, Math.floor(now / 1000) - 600),
      body,
    }));
    expect(stale.status).toBe(401);
    expect(applyResend).toHaveBeenCalledTimes(1);

    const again = await resendPost(new Request("https://summittmindset.com/api/acquisition/resend", {
      method: "POST",
      headers: resendHeaders(body, Math.floor(now / 1000)),
      body,
    }));
    expect(again.status).toBe(200);
    expect(applyResend).toHaveBeenNthCalledWith(2, { kind: "delivered", providerMessageId: "em_delivered" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const handleMock = vi.fn();
vi.mock("@/lib/apple-iap/notifications", () => ({
  handleAppleServerNotification: (...args: unknown[]) => handleMock(...args),
}));

const JWS = "header.payload.signature";

function webhookRequest(body: unknown = { signedPayload: JWS }): Request {
  return new Request("http://localhost/api/apple/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/apple/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    handleMock.mockResolvedValue({ ok: true, outcome: "processed" });
  });

  it("malformed body => 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/apple/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(handleMock).not.toHaveBeenCalled();
  });

  it("missing signedPayload => 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(webhookRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_signed_payload" });
  });

  it("maps handler 400/500/200", async () => {
    const { POST } = await import("./route");
    handleMock.mockResolvedValueOnce({
      ok: false,
      http: 400,
      error: "apple_iap_verification_failed",
    });
    const bad = await POST(webhookRequest());
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "apple_iap_verification_failed",
    });

    handleMock.mockResolvedValueOnce({
      ok: false,
      http: 500,
      error: "Internal Server Error",
    });
    const retry = await POST(webhookRequest());
    expect(retry.status).toBe(500);
    expect(await retry.json()).toEqual({ error: "Internal Server Error" });

    const ok = await POST(webhookRequest());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toEqual({ ok: true });
  });

  it("does not require Clerk auth", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/apple/webhook/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("@clerk/nextjs");
    expect(src).not.toContain("auth()");
    const { POST } = await import("./route");
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(handleMock).toHaveBeenCalledWith(JWS);
  });

  it("does not require App Store API issuer/key/private key", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/apple/webhook/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("api-client");
    expect(src).not.toContain("APPLE_IAP_ISSUER_ID");
    expect(src).not.toContain("APPLE_IAP_PRIVATE_KEY");
    expect(src).toContain("handleAppleServerNotification");
  });

  it("does not return or log the raw signedPayload", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const { POST } = await import("./route");
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(JWS);
    expect(JSON.stringify(logged)).not.toContain(JWS);
    spy.mockRestore();
  });
});

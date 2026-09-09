import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("meta-capi", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
    process.env.META_CAPI_ACCESS_TOKEN = "test_capi_token";
  });

    afterEach(() => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
    delete process.env.META_CAPI_ACCESS_TOKEN;
    delete process.env.META_CAPI_TEST_EVENT_CODE;
    delete process.env.VERCEL_ENV;
  });

  it("hashes Clerk user id as lowercase SHA-256 hex and never returns the raw id", async () => {
    const { hashMetaExternalId } = await import("./meta-capi");
    const hash = hashMetaExternalId("user_abc123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("user_");
    expect(hashMetaExternalId("")).toBeNull();
    expect(hashMetaExternalId("  ")).toBeNull();
    expect(hashMetaExternalId(null)).toBeNull();
  });

  it("builds StartTrial payload without email, phone, value, or raw Clerk id", async () => {
    const { buildMetaCapiEventPayload, hashMetaExternalId } = await import("./meta-capi");
    const externalIdHash = hashMetaExternalId("user_abc123")!;
    const payload = buildMetaCapiEventPayload({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
      externalIdHash,
    });
    expect(payload.event_name).toBe("StartTrial");
    expect(payload.event_id).toBe("start_trial:sub_1");
    expect(payload.action_source).toBe("website");
    expect(payload.custom_data).toBeUndefined();
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/email|phone|@|user_abc123/i);
    expect((payload.user_data as { external_id: string }).external_id).toBe(externalIdHash);
  });

  it("StartTrial user_data may include unhashed fbc/fbp/IP/UA and never email/phone/name", async () => {
    const { buildMetaCapiEventPayload, hashMetaExternalId } = await import("./meta-capi");
    const externalIdHash = hashMetaExternalId("user_abc123")!;
    const payload = buildMetaCapiEventPayload({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
      externalIdHash,
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0 TestBrowser",
    });
    const userData = payload.user_data as Record<string, string>;
    expect(userData.external_id).toBe(externalIdHash);
    expect(userData.fbc).toBe("fb.1.1700000000000.AbCdEf");
    expect(userData.fbp).toBe("fb.1.1700000000000.1234567890");
    expect(userData.client_ip_address).toBe("8.8.8.8");
    expect(userData.client_user_agent).toBe("Mozilla/5.0 TestBrowser");
    expect(payload.event_source_url).toBe("https://www.summittmindset.com/subscribe");
    expect(payload.event_name).toBe("StartTrial");
    expect(payload.action_source).toBe("website");
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/email|phone|@|user_abc123/i);
    expect(json).not.toMatch(/Ask Pat|Victory Room|SMS|card/i);
  });

  it("omits missing fbc/fbp/IP/UA and never fabricates fbp", async () => {
    const { buildMetaCapiEventPayload } = await import("./meta-capi");
    const payload = buildMetaCapiEventPayload({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
      externalIdHash: "a".repeat(64),
    });
    const userData = payload.user_data as Record<string, string>;
    expect(userData.external_id).toBe("a".repeat(64));
    expect(userData.fbc).toBeUndefined();
    expect(userData.fbp).toBeUndefined();
    expect(userData.client_ip_address).toBeUndefined();
    expect(userData.client_user_agent).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/fb\.1\.\d+\.\d+/);
  });

  it("builds Subscribe custom_data from actual amount_paid/100 and USD", async () => {
    const { buildMetaCapiEventPayload } = await import("./meta-capi");
    const payload = buildMetaCapiEventPayload({
      eventName: "Subscribe",
      eventTime: 1700000000,
      eventId: "subscribe:sub_1",
      value: 29.99,
      currency: "USD",
    });
    expect(payload.custom_data).toEqual({ value: 29.99, currency: "USD" });
    expect(JSON.stringify(payload)).not.toMatch(/29\b(?!\.99)|249|19\.99/);
  });

  it("missing token fails open without fetching", async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    const { sendMetaCapiEvent } = await import("./meta-capi");
    const result = await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    expect(result).toEqual({ ok: false, reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing Pixel ID fails open without fetching", async () => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    const { sendMetaCapiEvent } = await import("./meta-capi");
    const result = await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    expect(result).toEqual({ ok: false, reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kill switch fails open without fetching", async () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ENABLED = "false";
    const { sendMetaCapiEvent } = await import("./meta-capi");
    const result = await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    expect(result).toEqual({ ok: false, reason: "pixel_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-2xx fails open", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { sendMetaCapiEvent, META_CAPI_GRAPH_VERSION } = await import("./meta-capi");
    const result = await sendMetaCapiEvent({
      eventName: "Subscribe",
      eventTime: 1700000000,
      eventId: "subscribe:sub_1",
      value: 29,
      currency: "USD",
    });
    expect(result).toEqual({ ok: false, reason: "http_500" });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain(`graph.facebook.com/${META_CAPI_GRAPH_VERSION}/`);
    expect(url).not.toContain("test_capi_token");
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    const parsed = JSON.parse(init.body) as { access_token: string; data: unknown[] };
    expect(parsed.access_token).toBe("test_capi_token");
  });

  it("timeout fails open", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const { sendMetaCapiEvent } = await import("./meta-capi");
    const result = await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("does not log the access token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const { sendMetaCapiEvent } = await import("./meta-capi");
    await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    const dumped = JSON.stringify(warn.mock.calls);
    expect(dumped).not.toContain("test_capi_token");
    expect(dumped).not.toContain("META_CAPI_ACCESS_TOKEN");
    warn.mockRestore();
  });

  it("includes test_event_code only when META_CAPI_TEST_EVENT_CODE is set", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { sendMetaCapiEvent } = await import("./meta-capi");
    await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body).test_event_code).toBeUndefined();

    vi.resetModules();
    process.env.META_CAPI_TEST_EVENT_CODE = "TEST12345";
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const capi = await import("./meta-capi");
    await capi.sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    const withCode = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    ) as { test_event_code?: string; access_token: string };
    expect(withCode.test_event_code).toBe("TEST12345");
    delete process.env.META_CAPI_TEST_EVENT_CODE;
  });

  it("production VERCEL_ENV ignores test_event_code for StartTrial and Subscribe", async () => {
    process.env.META_CAPI_TEST_EVENT_CODE = "TEST12345";
    process.env.VERCEL_ENV = "production";
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { sendMetaCapiEvent, resolveMetaCapiTestEventCode } = await import(
      "./meta-capi"
    );
    expect(
      resolveMetaCapiTestEventCode({
        META_CAPI_TEST_EVENT_CODE: "TEST12345",
        VERCEL_ENV: "production",
      })
    ).toBeNull();

    for (const eventName of ["StartTrial", "Subscribe"] as const) {
      fetchMock.mockClear();
      await sendMetaCapiEvent({
        eventName,
        eventTime: 1700000000,
        eventId:
          eventName === "StartTrial" ? "start_trial:sub_1" : "subscribe:sub_1",
        value: eventName === "Subscribe" ? 29 : null,
        currency: eventName === "Subscribe" ? "USD" : null,
      });
      const body = JSON.parse(
        (fetchMock.mock.calls[0]?.[1] as { body: string }).body
      ) as { test_event_code?: string };
      expect(body.test_event_code).toBeUndefined();
    }
  });

  it("preview VERCEL_ENV allows test_event_code", async () => {
    process.env.META_CAPI_TEST_EVENT_CODE = "TEST12345";
    process.env.VERCEL_ENV = "preview";
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { sendMetaCapiEvent, resolveMetaCapiTestEventCode } = await import(
      "./meta-capi"
    );
    expect(
      resolveMetaCapiTestEventCode({
        META_CAPI_TEST_EVENT_CODE: "TEST12345",
        VERCEL_ENV: "preview",
      })
    ).toBe("TEST12345");
    await sendMetaCapiEvent({
      eventName: "StartTrial",
      eventTime: 1700000000,
      eventId: "start_trial:sub_1",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    ) as { test_event_code?: string };
    expect(body.test_event_code).toBe("TEST12345");
  });
});

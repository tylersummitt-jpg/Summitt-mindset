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
});

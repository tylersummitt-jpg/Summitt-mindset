import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  googleAdsAccessToken,
  postGoogleAdsIngest,
  resetGoogleAdsTokenCacheForTests,
} from "@/lib/google-ads/data-manager-client";
import {
  DATA_MANAGER_INGEST_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  type GoogleAdsConfig,
} from "@/lib/google-ads/data-manager-payload";

const config: GoogleAdsConfig = {
  customerId: "2101350707",
  loginCustomerId: null,
  trialActionId: "7861619714",
  paymentActionId: "7861626227",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("Data Manager client", () => {
  beforeEach(() => {
    resetGoogleAdsTokenCacheForTests();
  });

  it("refreshes an access token without logging the secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=refresh-token");
      return jsonResponse(200, { access_token: "ya29.test", expires_in: 3600 });
    });
    const token = await googleAdsAccessToken(config, fetchImpl as unknown as typeof fetch);
    expect(token).toBe("ya29.test");
    expect(fetchImpl).toHaveBeenCalledWith(GOOGLE_OAUTH_TOKEN_URL, expect.any(Object));
    expect(warn).not.toHaveBeenCalled();
    const again = await googleAdsAccessToken(config, fetchImpl as unknown as typeof fetch);
    expect(again).toBe("ya29.test");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("posts the ingest body and records acceptance only from a requestId", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(DATA_MANAGER_INGEST_URL);
      expect(init?.headers).toMatchObject({ authorization: "Bearer ya29.test" });
      const body = JSON.parse(String(init?.body));
      expect(body.validateOnly).toBe(false);
      expect(body.events[0].transactionId).toBe("start_trial:sub_1");
      expect(JSON.stringify(body)).not.toContain("consent");
      return jsonResponse(200, { requestId: "req-accepted" });
    });
    const result = await postGoogleAdsIngest({
      config,
      accessToken: "ya29.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      draft: {
        kind: "trial_started",
        transactionId: "start_trial:sub_1",
        eventTimeUnix: 1_700_000_000,
        click: { type: "gclid", value: "EAIaIQobChMI_test" },
        valueUsd: null,
      },
    });
    expect(result).toEqual({ outcome: "ingestion_accepted", requestId: "req-accepted" });
  });

  it("returns not_accepted when the token endpoint or ingest call fails", async () => {
    const tokenFetch = vi.fn(async () => jsonResponse(401, { error: "invalid_grant" }));
    expect(await googleAdsAccessToken(config, tokenFetch as unknown as typeof fetch)).toBeNull();

    const ingestFetch = vi.fn(async () => jsonResponse(503, { error: { status: "UNAVAILABLE" } }));
    const result = await postGoogleAdsIngest({
      config,
      accessToken: "ya29.test",
      fetchImpl: ingestFetch as unknown as typeof fetch,
      draft: {
        kind: "first_payment",
        transactionId: "subscribe:sub_1",
        eventTimeUnix: 1_700_604_800,
        click: { type: "gclid", value: "EAIaIQobChMI_test" },
        valueUsd: 29.99,
      },
    });
    expect(result).toEqual({ outcome: "not_accepted", reason: "UNAVAILABLE" });
  });
});

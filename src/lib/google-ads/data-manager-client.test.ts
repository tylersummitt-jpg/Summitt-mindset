import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  googleAdsAccessToken,
  postGoogleAdsIngest,
  resetGoogleAdsTokenCacheForTests,
} from "@/lib/google-ads/data-manager-client";
import {
  DATA_MANAGER_INGEST_URL,
  GOOGLE_DATA_MANAGER_SCOPE,
  GOOGLE_STS_TOKEN_URL,
  googleOidcAudience,
  googleStsAudience,
  type GoogleAdsConfig,
} from "@/lib/google-ads/data-manager-payload";

const config: GoogleAdsConfig = {
  customerId: "2101350707",
  loginCustomerId: null,
  trialActionId: "7861619714",
  paymentActionId: "7861626227",
  projectNumber: "123456789012",
  poolId: "vercel",
  providerId: "vercel",
  serviceAccountEmail:
    "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com",
};

const OIDC_AUDIENCE =
  "https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel";
const STS_AUDIENCE =
  "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function subjectToken() {
  return vi.fn(async () => "oidc-subject-token");
}

function federationFetch(args?: {
  stsStatus?: number;
  impersonationStatus?: number;
  accessToken?: string;
  expireTime?: string;
}) {
  const stsStatus = args?.stsStatus ?? 200;
  const impersonationStatus = args?.impersonationStatus ?? 200;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    const body = String(init?.body ?? "");
    expect(body).not.toContain("refresh_token");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("client_secret");
    if (target === GOOGLE_STS_TOKEN_URL) {
      expect(init?.headers).toEqual({
        "content-type": "application/x-www-form-urlencoded",
      });
      const params = new URLSearchParams(body);
      expect(params.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:token-exchange"
      );
      expect(params.get("audience")).toBe(STS_AUDIENCE);
      expect(params.get("scope")).toBe("https://www.googleapis.com/auth/cloud-platform");
      expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:jwt");
      expect(params.get("subject_token")).toBe("oidc-subject-token");
      if (stsStatus !== 200) return jsonResponse(stsStatus, { error: "sts_failed" });
      return jsonResponse(200, { access_token: "federated-token", expires_in: 3600 });
    }
    expect(target).toContain(":generateAccessToken");
    expect(target).toContain(
      encodeURIComponent(
        "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com"
      )
    );
    expect(init?.headers).toMatchObject({ authorization: "Bearer federated-token" });
    const impersonation = JSON.parse(body) as { scope?: string[]; lifetime?: string };
    expect(impersonation.scope).toEqual([GOOGLE_DATA_MANAGER_SCOPE]);
    expect(impersonation.lifetime).toBe("3600s");
    if (impersonationStatus !== 200) {
      return jsonResponse(impersonationStatus, { error: { status: "PERMISSION_DENIED" } });
    }
    return jsonResponse(200, {
      accessToken: args?.accessToken ?? "ya29.test",
      expireTime: args?.expireTime ?? "2026-10-21T18:00:00.000Z",
    });
  });
}

describe("Data Manager client", () => {
  beforeEach(() => {
    resetGoogleAdsTokenCacheForTests();
    vi.useRealTimers();
  });

  it("exchanges the production audience and caches the Data Manager token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T16:00:00.000Z"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const subject = subjectToken();
    const fetchImpl = federationFetch();
    const token = await googleAdsAccessToken(
      config,
      fetchImpl as unknown as typeof fetch,
      subject
    );
    expect(googleOidcAudience(config)).toBe(OIDC_AUDIENCE);
    expect(googleStsAudience(config)).toBe(STS_AUDIENCE);
    expect(subject).toHaveBeenCalledWith(OIDC_AUDIENCE);
    expect(token).toBe("ya29.test");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const again = await googleAdsAccessToken(
      config,
      fetchImpl as unknown as typeof fetch,
      subject
    );
    expect(again).toBe("ya29.test");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(subject).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    error.mockRestore();
  });

  it("refreshes after the expiration skew and rejects a token already inside it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T16:00:00.000Z"));
    const subject = subjectToken();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url) === GOOGLE_STS_TOKEN_URL) {
        return jsonResponse(200, { access_token: "federated-token", expires_in: 3600 });
      }
      const calls = fetchImpl.mock.calls.filter((call) => String(call[0]) !== GOOGLE_STS_TOKEN_URL)
        .length;
      return jsonResponse(200, {
        accessToken: calls === 1 ? "ya29.first" : "ya29.second",
        expireTime: calls === 1 ? "2026-10-21T16:02:00.000Z" : "2026-10-21T18:00:00.000Z",
      });
    });
    const first = await googleAdsAccessToken(
      config,
      fetchImpl as unknown as typeof fetch,
      subject
    );
    expect(first).toBe("ya29.first");
    vi.setSystemTime(new Date("2026-10-21T16:00:30.000Z"));
    const cached = await googleAdsAccessToken(
      config,
      fetchImpl as unknown as typeof fetch,
      subject
    );
    expect(cached).toBe("ya29.first");
    vi.setSystemTime(new Date("2026-10-21T16:01:01.000Z"));
    const refreshed = await googleAdsAccessToken(
      config,
      fetchImpl as unknown as typeof fetch,
      subject
    );
    expect(refreshed).toBe("ya29.second");

    resetGoogleAdsTokenCacheForTests();
    vi.setSystemTime(new Date("2026-10-21T16:00:00.000Z"));
    const shortLived = vi.fn(async (url: string) => {
      if (String(url) === GOOGLE_STS_TOKEN_URL) {
        return jsonResponse(200, { access_token: "federated-token", expires_in: 3600 });
      }
      return jsonResponse(200, {
        accessToken: "ya29.short",
        expireTime: "2026-10-21T16:00:30.000Z",
      });
    });
    expect(
      await googleAdsAccessToken(config, shortLived as unknown as typeof fetch, subject)
    ).toBeNull();
  });

  it("fails closed when the security token exchange fails", async () => {
    const fetchImpl = federationFetch({ stsStatus: 401 });
    expect(
      await googleAdsAccessToken(config, fetchImpl as unknown as typeof fetch, subjectToken())
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when service-account impersonation fails", async () => {
    const fetchImpl = federationFetch({ impersonationStatus: 403 });
    expect(
      await googleAdsAccessToken(config, fetchImpl as unknown as typeof fetch, subjectToken())
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the OIDC token cannot be read", async () => {
    const fetchImpl = vi.fn();
    const subject = vi.fn(async () => {
      throw new Error("oidc missing");
    });
    expect(
      await googleAdsAccessToken(config, fetchImpl as unknown as typeof fetch, subject)
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("returns not_accepted when ingest fails", async () => {
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

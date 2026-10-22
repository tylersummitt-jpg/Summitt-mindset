import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeGoogleAdsFederation } from "@/lib/google-ads/federation-probe";

const root = process.cwd();
const OIDC_AUDIENCE =
  "https://iam.googleapis.com/projects/400597218521/locations/global/workloadIdentityPools/vercel-production/providers/vercel-summitt-mindset";
const STS_AUDIENCE =
  "//iam.googleapis.com/projects/400597218521/locations/global/workloadIdentityPools/vercel-production/providers/vercel-summitt-mindset";
const SUBJECT = "owner:tyler-summitts-projects:project:summitt-mindset:environment:production";
const OIDC_SECRET = "oidc-secret-token";
const FEDERATED_SECRET = "federated-secret-token";
const ACCESS_SECRET = "ya29.datamanager-secret";
const NOW = Date.parse("2026-10-22T12:00:00.000Z");

function jwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.${OIDC_SECRET}`;
}

function productionEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    VERCEL_ENV: "production",
    GOOGLE_ADS_CUSTOMER_ID: "2101350707",
    GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID: "7861619714",
    GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID: "7861626227",
    GOOGLE_CLOUD_PROJECT_NUMBER: "400597218521",
    GOOGLE_WORKLOAD_IDENTITY_POOL_ID: "vercel-production",
    GOOGLE_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel-summitt-mindset",
    GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL:
      "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com",
    ...overrides,
  };
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://oidc.vercel.com/tyler-summitts-projects",
    sub: SUBJECT,
    aud: OIDC_AUDIENCE,
    exp: Math.floor(NOW / 1000) + 600,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successFetch(expireTime = "2026-10-22T13:00:00.000Z") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href === "https://sts.googleapis.com/v1/token") {
      return jsonResponse(200, {
        access_token: FEDERATED_SECRET,
        error_description: "do-not-return-sts-body",
      });
    }
    if (href.includes(":generateAccessToken")) {
      return jsonResponse(200, {
        accessToken: ACCESS_SECRET,
        expireTime,
        error: { message: "do-not-return-iam-body" },
      });
    }
    return jsonResponse(500, { error: "unexpected-url" });
  });
  return { fetchImpl, calls };
}

function expectNoSecrets(value: unknown) {
  const encoded = JSON.stringify(value);
  expect(encoded).not.toContain(OIDC_SECRET);
  expect(encoded).not.toContain(FEDERATED_SECRET);
  expect(encoded).not.toContain(ACCESS_SECRET);
  expect(encoded).not.toContain("do-not-return");
  expect(encoded).not.toContain("access_token");
  expect(encoded).not.toContain("accessToken");
  expect(encoded).not.toContain("subject_token");
  expect(encoded).not.toContain("eyJ");
}

describe("temporary Google Ads federation probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops before Google outside production", async () => {
    const subject = vi.fn();
    const fetchImpl = vi.fn();
    for (const vercelEnv of ["preview", "development", undefined]) {
      const result = await probeGoogleAdsFederation({
        env: productionEnv({ VERCEL_ENV: vercelEnv }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        subjectToken: subject,
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("not_production");
      expect(result.tokenAccepted).toBe(false);
    }
    expect(subject).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when federation configuration is missing or unexpected", async () => {
    const subject = vi.fn();
    const fetchImpl = vi.fn();
    const missing = await probeGoogleAdsFederation({
      env: productionEnv({ GOOGLE_CLOUD_PROJECT_NUMBER: undefined }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: subject,
      nowMs: NOW,
    });
    const wrongPool = await probeGoogleAdsFederation({
      env: productionEnv({ GOOGLE_WORKLOAD_IDENTITY_POOL_ID: "vercel-preview" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: subject,
      nowMs: NOW,
    });
    expect(missing.stage).toBe("credentials_missing");
    expect(wrongPool.stage).toBe("credentials_missing");
    expect(subject).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not exchange a token while ingestion is enabled", async () => {
    const subject = vi.fn();
    const fetchImpl = vi.fn();
    const result = await probeGoogleAdsFederation({
      env: productionEnv({ GOOGLE_ADS_INGEST_ENABLED: "true" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: subject,
      nowMs: NOW,
    });
    expect(result).toMatchObject({ ok: false, stage: "ingest_enabled", ingestEnabled: true });
    expect(subject).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the OIDC token is missing", async () => {
    const fetchImpl = vi.fn();
    const thrown = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => {
        throw new Error(`oidc failed ${ACCESS_SECRET}`);
      },
      nowMs: NOW,
    });
    const empty = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => "",
      nowMs: NOW,
    });
    expect(thrown.stage).toBe("oidc_missing");
    expect(empty.stage).toBe("oidc_missing");
    expect(fetchImpl).not.toHaveBeenCalled();
    expectNoSecrets(thrown);
    expectNoSecrets(empty);
  });

  it("accepts the global Vercel issuer", async () => {
    const { fetchImpl } = successFetch();
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => jwt(claims({ iss: "https://oidc.vercel.com" })),
      nowMs: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.issuerOk).toBe(true);
    expectNoSecrets(result);
  });

  it.each([
    ["issuer", { iss: "https://evil.example" }],
    ["subject", { sub: "owner:tyler-summitts-projects:project:summitt-mindset:environment:preview" }],
    ["audience", { aud: "https://example.invalid/audience" }],
  ])("rejects an OIDC %s mismatch before STS", async (_label, override) => {
    const fetchImpl = vi.fn();
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => jwt(claims(override)),
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("oidc_claims");
    expect(result.stsStatus).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it("reports only the STS status when the exchange fails", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: "invalid_grant", error_description: ACCESS_SECRET })
    );
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => jwt(claims()),
      nowMs: NOW,
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "sts",
      stsStatus: 401,
      impersonationStatus: null,
      tokenAccepted: false,
      ingestEnabled: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expectNoSecrets(result);
  });

  it("reports only the impersonation status when IAM rejects the subject", async () => {
    const { fetchImpl } = successFetch();
    fetchImpl.mockImplementation(async (url: string | URL | Request) => {
      if (String(url) === "https://sts.googleapis.com/v1/token") {
        return jsonResponse(200, { access_token: FEDERATED_SECRET });
      }
      return jsonResponse(403, { error: { message: ACCESS_SECRET } });
    });
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => jwt(claims()),
      nowMs: NOW,
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "impersonation",
      stsStatus: 200,
      impersonationStatus: 403,
      tokenAccepted: false,
    });
    expectNoSecrets(result);
  });

  it("rejects a Data Manager token that is inside the 60 second window", async () => {
    const { fetchImpl } = successFetch("2026-10-22T12:01:00.000Z");
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async () => jwt(claims()),
      nowMs: NOW,
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "token_lifetime",
      tokenAccepted: false,
      expiresInSeconds: 60,
    });
    expectNoSecrets(result);
  });

  it("accepts production federation without returning token material", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl, calls } = successFetch();
    const result = await probeGoogleAdsFederation({
      env: productionEnv(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      subjectToken: async (audience) => {
        expect(audience).toBe(OIDC_AUDIENCE);
        return jwt(claims());
      },
      nowMs: NOW,
    });
    expect(result).toEqual({
      ok: true,
      stage: "ready",
      ingestEnabled: false,
      issuerOk: true,
      subjectOk: true,
      audienceOk: true,
      stsStatus: 200,
      impersonationStatus: 200,
      tokenAccepted: true,
      expiresInSeconds: 3600,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://sts.googleapis.com/v1/token");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    const stsBody = String(calls[0]?.init?.body);
    expect(stsBody).toContain(encodeURIComponent(STS_AUDIENCE));
    expect(stsBody).not.toContain("refresh_token");
    expect(calls[1]?.url).toContain(
      "summitt-google-ads-conversions%40summitt-mindset.iam.gserviceaccount.com:generateAccessToken"
    );
    expect(String(calls[1]?.init?.body)).toContain(
      "https://www.googleapis.com/auth/datamanager"
    );
    expect(calls.map((call) => call.url).join(" ")).not.toContain("datamanager.googleapis.com");
    expectNoSecrets(result);
    expect(logs).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("is not linked from the operator navigation and does not run on page render", () => {
    const page = readFileSync(
      path.join(root, "src/app/internal/google-ads-auth/page.tsx"),
      "utf8"
    );
    const probe = readFileSync(path.join(root, "src/lib/google-ads/federation-probe.ts"), "utf8");
    expect(page).not.toContain("probeGoogleAdsFederation");
    expect(page).toContain("GoogleAdsAuthProbeForm");
    expect(probe).not.toContain("datamanager.googleapis.com");
    expect(probe).not.toContain("postGoogleAdsIngest");
    expect(probe).not.toContain("supabase");
    for (const rel of [
      "src/app/internal/layout.tsx",
      "src/app/internal/coach-state/page.tsx",
      "src/app/internal/sms-qa/page.tsx",
      "src/app/internal/refresh-reconcile/page.tsx",
    ]) {
      expect(readFileSync(path.join(root, rel), "utf8")).not.toContain("google-ads-auth");
    }
  });
});

/**
 * TEMPORARY production authentication probe.
 * Remove this file after the one-time production check.
 * It never calls Data Manager ingest and never returns token material.
 */

import {
  GOOGLE_DATA_MANAGER_SCOPE,
  GOOGLE_STS_IMPERSONATION_SCOPE,
  GOOGLE_STS_TOKEN_URL,
  googleAdsIngestEnabled,
  googleOidcAudience,
  googleStsAudience,
  readGoogleAdsConfig,
} from "@/lib/google-ads/data-manager-payload";

const EXPECTED_PROJECT_NUMBER = "400597218521";
const EXPECTED_POOL_ID = "vercel-production";
const EXPECTED_PROVIDER_ID = "vercel-summitt-mindset";
const EXPECTED_SERVICE_ACCOUNT_EMAIL =
  "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com";
const ALLOWED_ISSUERS = new Set([
  "https://oidc.vercel.com",
  "https://oidc.vercel.com/tyler-summitts-projects",
]);
const EXPECTED_SUBJECT =
  "owner:tyler-summitts-projects:project:summitt-mindset:environment:production";
const TOKEN_LIFETIME_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

export type GoogleAdsAuthProbeStage =
  | "not_production"
  | "credentials_missing"
  | "ingest_enabled"
  | "oidc_missing"
  | "oidc_claims"
  | "sts"
  | "impersonation"
  | "token_lifetime"
  | "ready";

export type GoogleAdsAuthProbeResult = {
  ok: boolean;
  stage: GoogleAdsAuthProbeStage;
  ingestEnabled: boolean;
  issuerOk: boolean;
  subjectOk: boolean;
  audienceOk: boolean;
  stsStatus: number | null;
  impersonationStatus: number | null;
  tokenAccepted: boolean;
  expiresInSeconds: number | null;
};

type OidcClaims = { iss: string; sub: string; aud: string; exp: number };

function status(partial: GoogleAdsAuthProbeResult): GoogleAdsAuthProbeResult {
  return {
    ok: partial.ok,
    stage: partial.stage,
    ingestEnabled: partial.ingestEnabled,
    issuerOk: partial.issuerOk,
    subjectOk: partial.subjectOk,
    audienceOk: partial.audienceOk,
    stsStatus: partial.stsStatus,
    impersonationStatus: partial.impersonationStatus,
    tokenAccepted: partial.tokenAccepted,
    expiresInSeconds: partial.expiresInSeconds,
  };
}

function closed(
  stage: GoogleAdsAuthProbeStage,
  ingestEnabled: boolean,
  extra?: Partial<GoogleAdsAuthProbeResult>
): GoogleAdsAuthProbeResult {
  return status({
    ok: false,
    stage,
    ingestEnabled,
    issuerOk: false,
    subjectOk: false,
    audienceOk: false,
    stsStatus: null,
    impersonationStatus: null,
    tokenAccepted: false,
    expiresInSeconds: null,
    ...extra,
  });
}

function httpStatus(value: number): number | null {
  if (!Number.isInteger(value) || value < 100 || value > 599) return null;
  return value;
}

function oidcClaims(token: string): OidcClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    if (typeof record.iss !== "string" || typeof record.sub !== "string") return null;
    if (typeof record.aud !== "string" || typeof record.exp !== "number") return null;
    if (!Number.isFinite(record.exp)) return null;
    return { iss: record.iss, sub: record.sub, aud: record.aud, exp: record.exp };
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function defaultSubjectToken(audience: string): Promise<string> {
  const { getVercelOidcToken } = await import("@vercel/oidc");
  const token = await getVercelOidcToken({ audience });
  return typeof token === "string" ? token.trim() : "";
}

export async function probeGoogleAdsFederation(args: {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  subjectToken?: (audience: string) => Promise<string>;
  nowMs?: number;
}): Promise<GoogleAdsAuthProbeResult> {
  const ingestEnabled = googleAdsIngestEnabled(args.env);
  if (args.env.VERCEL_ENV !== "production") {
    return closed("not_production", ingestEnabled);
  }

  const config = readGoogleAdsConfig(args.env);
  if (
    !config ||
    config.projectNumber !== EXPECTED_PROJECT_NUMBER ||
    config.poolId !== EXPECTED_POOL_ID ||
    config.providerId !== EXPECTED_PROVIDER_ID ||
    config.serviceAccountEmail !== EXPECTED_SERVICE_ACCOUNT_EMAIL
  ) {
    return closed("credentials_missing", ingestEnabled);
  }
  if (ingestEnabled) return closed("ingest_enabled", true);

  const subjectToken = args.subjectToken ?? defaultSubjectToken;
  const fetchImpl = args.fetchImpl ?? fetch;
  const nowMs = args.nowMs ?? Date.now();
  const oidcAudience = googleOidcAudience(config);
  let oidcToken = "";
  try {
    oidcToken = (await subjectToken(oidcAudience)).trim();
  } catch {
    return closed("oidc_missing", false);
  }
  if (!oidcToken) return closed("oidc_missing", false);

  const claims = oidcClaims(oidcToken);
  const issuerOk = Boolean(claims && ALLOWED_ISSUERS.has(claims.iss));
  const subjectOk = Boolean(claims && claims.sub === EXPECTED_SUBJECT);
  const audienceOk = Boolean(claims && claims.aud === oidcAudience);
  const claimsFresh = Boolean(claims && claims.exp * 1000 > nowMs);
  if (!claims || !issuerOk || !subjectOk || !audienceOk || !claimsFresh) {
    return closed("oidc_claims", false, { issuerOk, subjectOk, audienceOk });
  }

  let stsResponse: Response;
  try {
    const stsBody = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: googleStsAudience(config),
      scope: GOOGLE_STS_IMPERSONATION_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidcToken,
    });
    stsResponse = await fetchImpl(GOOGLE_STS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: stsBody,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return closed("sts", false, { issuerOk, subjectOk, audienceOk });
  }
  const stsStatus = httpStatus(stsResponse.status);
  const stsPayload = stsResponse.ok ? await readJson(stsResponse) : null;
  const federated =
    stsPayload && typeof stsPayload === "object"
      ? (stsPayload as { access_token?: unknown }).access_token
      : null;
  if (!stsResponse.ok || typeof federated !== "string" || !federated.trim()) {
    return closed("sts", false, { issuerOk, subjectOk, audienceOk, stsStatus });
  }

  let impersonateResponse: Response;
  try {
    const impersonateUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`;
    impersonateResponse = await fetchImpl(impersonateUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${federated.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: [GOOGLE_DATA_MANAGER_SCOPE],
        lifetime: "3600s",
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return closed("impersonation", false, {
      issuerOk,
      subjectOk,
      audienceOk,
      stsStatus,
    });
  }
  const impersonationStatus = httpStatus(impersonateResponse.status);
  const impersonated = impersonateResponse.ok ? await readJson(impersonateResponse) : null;
  const accessToken =
    impersonated && typeof impersonated === "object"
      ? (impersonated as { accessToken?: unknown }).accessToken
      : null;
  const expireTime =
    impersonated && typeof impersonated === "object"
      ? (impersonated as { expireTime?: unknown }).expireTime
      : null;
  if (!impersonateResponse.ok || typeof accessToken !== "string" || !accessToken.trim()) {
    return closed("impersonation", false, {
      issuerOk,
      subjectOk,
      audienceOk,
      stsStatus,
      impersonationStatus,
    });
  }
  const expireMs = typeof expireTime === "string" ? Date.parse(expireTime) : Number.NaN;
  const remainMs = expireMs - nowMs;
  if (!Number.isFinite(remainMs) || remainMs <= TOKEN_LIFETIME_MS) {
    return closed("token_lifetime", false, {
      issuerOk,
      subjectOk,
      audienceOk,
      stsStatus,
      impersonationStatus,
      expiresInSeconds: Number.isFinite(remainMs) ? Math.floor(remainMs / 1000) : null,
    });
  }

  return status({
    ok: true,
    stage: "ready",
    ingestEnabled: false,
    issuerOk,
    subjectOk,
    audienceOk,
    stsStatus,
    impersonationStatus,
    tokenAccepted: true,
    expiresInSeconds: Math.floor(remainMs / 1000),
  });
}

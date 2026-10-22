/**
 * Workload Identity token exchange and one Data Manager ingest POST.
 * OIDC, federated, and access tokens are never logged.
 * ingestion_accepted is not processing and not attribution.
 */

import {
  buildDataManagerIngestBody,
  classifyIngestResponse,
  DATA_MANAGER_INGEST_URL,
  GOOGLE_DATA_MANAGER_SCOPE,
  GOOGLE_STS_IMPERSONATION_SCOPE,
  GOOGLE_STS_TOKEN_URL,
  googleOidcAudience,
  googleStsAudience,
  type GoogleAdsConfig,
  type GoogleAdsEventDraft,
  type IngestClassification,
} from "@/lib/google-ads/data-manager-payload";

const TOKEN_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

type CachedToken = { token: string; expiresAtMs: number };

let cachedToken: CachedToken | null = null;

export function resetGoogleAdsTokenCacheForTests(): void {
  cachedToken = null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function vercelOidcSubjectToken(audience: string): Promise<string> {
  const { getVercelOidcToken } = await import("@vercel/oidc");
  const token = await getVercelOidcToken({ audience });
  return typeof token === "string" ? token.trim() : "";
}

export async function googleAdsAccessToken(
  config: GoogleAdsConfig,
  fetchImpl: typeof fetch = fetch,
  subjectToken: (audience: string) => Promise<string> = vercelOidcSubjectToken
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now) return cachedToken.token;

  try {
    const oidcAudience = googleOidcAudience(config);
    const oidcToken = (await subjectToken(oidcAudience)).trim();
    if (!oidcToken) return null;

    const stsBody = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: googleStsAudience(config),
      scope: GOOGLE_STS_IMPERSONATION_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidcToken,
    });
    const stsResponse = await fetchImpl(GOOGLE_STS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: stsBody,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const stsPayload = await readJson(stsResponse);
    if (!stsResponse.ok || !stsPayload || typeof stsPayload !== "object") return null;
    const federated = (stsPayload as { access_token?: unknown }).access_token;
    if (typeof federated !== "string" || !federated.trim()) return null;

    const impersonateUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`;
    const impersonateResponse = await fetchImpl(impersonateUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${federated.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: [GOOGLE_DATA_MANAGER_SCOPE],
        lifetime: "3600s",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const impersonated = await readJson(impersonateResponse);
    if (!impersonateResponse.ok || !impersonated || typeof impersonated !== "object") {
      return null;
    }
    const accessToken = (impersonated as { accessToken?: unknown }).accessToken;
    const expireTime = (impersonated as { expireTime?: unknown }).expireTime;
    if (typeof accessToken !== "string" || !accessToken.trim()) return null;
    if (typeof expireTime !== "string") return null;
    const expireMs = Date.parse(expireTime);
    if (!Number.isFinite(expireMs)) return null;
    const expiresAtMs = expireMs - TOKEN_SKEW_MS;
    if (expiresAtMs <= Date.now()) return null;
    cachedToken = { token: accessToken.trim(), expiresAtMs };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export async function postGoogleAdsIngest(args: {
  config: GoogleAdsConfig;
  draft: GoogleAdsEventDraft;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<IngestClassification> {
  const body = buildDataManagerIngestBody(args.config, args.draft);
  if (!body) return { outcome: "not_accepted", reason: "invalid_body" };
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(DATA_MANAGER_INGEST_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await readJson(response);
    return classifyIngestResponse(response.status, payload);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { outcome: "not_accepted", reason: "timeout" };
    }
    return { outcome: "not_accepted", reason: "network" };
  }
}

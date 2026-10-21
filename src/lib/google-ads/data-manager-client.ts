/**
 * OAuth refresh and one Data Manager ingest POST.
 * The access token and refresh token are never logged.
 * ingestion_accepted is not processing and not attribution.
 */

import {
  buildDataManagerIngestBody,
  classifyIngestResponse,
  DATA_MANAGER_INGEST_URL,
  GOOGLE_OAUTH_TOKEN_URL,
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

export async function googleAdsAccessToken(
  config: GoogleAdsConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now) return cachedToken.token;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    });
    const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload || typeof payload !== "object") return null;
    const token = (payload as { access_token?: unknown }).access_token;
    const expiresIn = (payload as { expires_in?: unknown }).expires_in;
    if (typeof token !== "string" || !token.trim()) return null;
    const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 300;
    cachedToken = {
      token: token.trim(),
      expiresAtMs: Date.now() + seconds * 1000 - TOKEN_SKEW_MS,
    };
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

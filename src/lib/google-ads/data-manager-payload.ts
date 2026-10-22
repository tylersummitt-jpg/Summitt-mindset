/**
 * Data Manager `events:ingest` body for one Google Ads click conversion.
 * Click id only. No userData, consent signal, IP, or customer profile.
 * A requestId in the response means Google accepted ingestion. It does not
 * mean the event was processed or attributed.
 */

import type { GoogleClickId } from "@/lib/marketing-attribution-pure";

export const DATA_MANAGER_INGEST_URL =
  "https://datamanager.googleapis.com/v1/events:ingest" as const;

export const GOOGLE_STS_TOKEN_URL = "https://sts.googleapis.com/v1/token" as const;

/** Scope on the token that calls Data Manager. Not used for the intermediate exchange. */
export const GOOGLE_DATA_MANAGER_SCOPE =
  "https://www.googleapis.com/auth/datamanager" as const;

/**
 * Scope on the short-lived federated token. IAM Credentials requires it to
 * call generateAccessToken. That token is not sent to Data Manager.
 */
export const GOOGLE_STS_IMPERSONATION_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform" as const;

export type GoogleAdsConfig = {
  customerId: string;
  /** Set only when the caller is a manager account. Omitted for a direct account. */
  loginCustomerId: string | null;
  trialActionId: string;
  paymentActionId: string;
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
};

export type GoogleAdsEventDraft = {
  kind: "trial_started" | "first_payment";
  transactionId: string;
  eventTimeUnix: number;
  click: GoogleClickId;
  /** Dollars. Trial events omit value and currency. */
  valueUsd: number | null;
};

const CUSTOMER_ID = /^\d{10}$/;
const ACTION_ID = /^\d{6,20}$/;

function digits(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^0-9]/g, "");
}

const WORKLOAD_ID = /^[a-z][a-z0-9-]{3,31}$/;
const PROJECT_NUMBER = /^\d{6,20}$/;
const SERVICE_ACCOUNT_EMAIL =
  /^[a-z0-9-]{3,30}@[a-z0-9-]{3,30}\.iam\.gserviceaccount\.com$/;

function workloadId(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!WORKLOAD_ID.test(value)) return null;
  return value;
}

function projectNumber(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!PROJECT_NUMBER.test(value)) return null;
  return value;
}

function serviceAccountEmail(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!SERVICE_ACCOUNT_EMAIL.test(value)) return null;
  return value;
}

/** Live ingestion stays off until this is exactly "true". */
export function googleAdsIngestEnabled(
  env: Record<string, string | undefined>
): boolean {
  return env.GOOGLE_ADS_INGEST_ENABLED === "true";
}

export function readGoogleAdsConfig(
  env: Record<string, string | undefined>
): GoogleAdsConfig | null {
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID);
  const trialActionId = digits(env.GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID);
  const paymentActionId = digits(env.GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID);
  const project = projectNumber(env.GOOGLE_CLOUD_PROJECT_NUMBER);
  const poolId = workloadId(env.GOOGLE_WORKLOAD_IDENTITY_POOL_ID);
  const providerId = workloadId(env.GOOGLE_WORKLOAD_IDENTITY_POOL_PROVIDER_ID);
  const serviceAccount = serviceAccountEmail(env.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL);
  if (!CUSTOMER_ID.test(customerId)) return null;
  if (!ACTION_ID.test(trialActionId) || !ACTION_ID.test(paymentActionId)) return null;
  if (trialActionId === paymentActionId) return null;
  if (!project || !poolId || !providerId || !serviceAccount) return null;

  const loginRaw = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  let loginCustomerId: string | null = null;
  if (typeof loginRaw === "string" && loginRaw.trim()) {
    const login = digits(loginRaw);
    if (!CUSTOMER_ID.test(login)) return null;
    loginCustomerId = login;
  }

  return {
    customerId,
    loginCustomerId,
    trialActionId,
    paymentActionId,
    projectNumber: project,
    poolId,
    providerId,
    serviceAccountEmail: serviceAccount,
  };
}

/** Audience placed on the Vercel OIDC token. Must match the provider's default audience. */
export function googleOidcAudience(config: GoogleAdsConfig): string {
  return `https://iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
}

/** Security Token Service audience. Google's resource name uses the //iam form. */
export function googleStsAudience(config: GoogleAdsConfig): string {
  return `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
}

export function rfc3339FromUnixSeconds(unix: number): string | null {
  if (!Number.isFinite(unix) || unix <= 0) return null;
  const date = new Date(Math.floor(unix) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function usdAmountFromStripeCents(cents: number): number | null {
  if (!Number.isInteger(cents) || cents <= 0) return null;
  return cents / 100;
}

export function googleAdsTransactionId(
  kind: GoogleAdsEventDraft["kind"],
  subscriptionId: string
): string | null {
  const id = subscriptionId.trim();
  if (!id || id.includes(" ") || id.length > 255) return null;
  return kind === "trial_started" ? `start_trial:${id}` : `subscribe:${id}`;
}

export function buildDataManagerIngestBody(
  config: GoogleAdsConfig,
  draft: GoogleAdsEventDraft
): Record<string, unknown> | null {
  const eventTimestamp = rfc3339FromUnixSeconds(draft.eventTimeUnix);
  const transactionId = draft.transactionId.trim();
  if (!eventTimestamp || !transactionId) return null;
  if (draft.click.type !== "gclid" && draft.click.type !== "wbraid" && draft.click.type !== "gbraid") {
    return null;
  }
  if (!draft.click.value) return null;

  const actionId =
    draft.kind === "trial_started" ? config.trialActionId : config.paymentActionId;
  const destination: Record<string, unknown> = {
    operatingAccount: {
      accountType: "GOOGLE_ADS",
      accountId: config.customerId,
    },
    productDestinationId: actionId,
  };
  if (config.loginCustomerId) {
    destination.loginAccount = {
      accountType: "GOOGLE_ADS",
      accountId: config.loginCustomerId,
    };
  }

  const event: Record<string, unknown> = {
    adIdentifiers: { [draft.click.type]: draft.click.value },
    eventTimestamp,
    transactionId,
    eventSource: "WEB",
  };
  if (draft.kind === "first_payment") {
    if (draft.valueUsd == null || !(draft.valueUsd > 0)) return null;
    event.conversionValue = draft.valueUsd;
    event.currency = "USD";
  }

  return {
    destinations: [destination],
    events: [event],
    validateOnly: false,
  };
}

export type IngestClassification =
  | { outcome: "ingestion_accepted"; requestId: string }
  | { outcome: "not_accepted"; reason: string };

/** HTTP success with a requestId is ingestion acceptance, not processing or attribution. */
export function classifyIngestResponse(
  httpStatus: number,
  body: unknown
): IngestClassification {
  if (httpStatus < 200 || httpStatus >= 300) {
    const status = googleErrorStatus(body);
    return { outcome: "not_accepted", reason: status ?? `http_${httpStatus}` };
  }
  const requestId =
    body && typeof body === "object" && "requestId" in body
      ? (body as { requestId?: unknown }).requestId
      : null;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.trim().length > 200) {
    return { outcome: "not_accepted", reason: "missing_request_id" };
  }
  return { outcome: "ingestion_accepted", requestId: requestId.trim() };
}

function googleErrorStatus(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "string") return null;
  const safe = status.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  return safe || null;
}

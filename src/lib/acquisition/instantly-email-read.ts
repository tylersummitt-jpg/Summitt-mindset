/**
 * Temporary read of one received Instantly email.
 * Delete this module and src/app/api/admin/acquisition/instantly-email-read/route.ts
 * after the approved production check. This module never posts a reply.
 */

export const INSTANTLY_EMAIL_LIST_URL =
  "https://api.instantly.ai/api/v2/emails?email_type=received&limit=1&preview_only=false";
export const INSTANTLY_API_KEYS_URL = "https://api.instantly.ai/api/v2/api-keys?limit=100";

const CREATE_SCOPES = new Set(["emails:create", "emails:all", "all:create", "all:all"]);
const SCOPE_NAME = /^(?:emails|all):(?:read|create|update|delete|all)$/;
const SAFE_ID = /^[A-Za-z0-9-]{1,80}$/;

export type InstantlyAccess = "verified" | "denied" | "unknown";

export type InstantlyFieldReport = {
  present: boolean;
  type: "absent" | "null" | "string" | "number" | "boolean" | "object" | "array";
  length: number | null;
};

export type InstantlyEmailReadReport = {
  emailRead: InstantlyAccess;
  emailReadStatus: number | null;
  replyPermission: InstantlyAccess;
  replyPermissionStatus: number | null;
  receivedCount: number;
  exactReplyTarget: boolean;
  fullTextAvailable: boolean | null;
  bodyTextLength: number | null;
  bodyHtmlPresent: boolean | null;
  bodyFallback: "too_large" | "unavailable" | null;
  threadIdPresent: boolean;
  receivedType: number | null;
  fields: {
    id: InstantlyFieldReport;
    thread_id: InstantlyFieldReport;
    subject: InstantlyFieldReport;
    eaccount: InstantlyFieldReport;
    lead: InstantlyFieldReport;
    campaign_id: InstantlyFieldReport;
    timestamp_email: InstantlyFieldReport;
    body: InstantlyFieldReport;
  };
  providerError: string | null;
};

function fieldType(value: unknown): InstantlyFieldReport["type"] {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "absent";
}

function fieldReport(source: Record<string, unknown>, name: string): InstantlyFieldReport {
  if (!Object.prototype.hasOwnProperty.call(source, name)) {
    return { present: false, type: "absent", length: null };
  }
  const value = source[name];
  return {
    present: true,
    type: fieldType(value),
    length: typeof value === "string" ? value.length : null,
  };
}

/** Same reply-target rule as the deployed webhook parser: unchanged, no spaces, at most 80 characters. */
export function exactReplyTargetAvailable(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && !/\s/.test(trimmed);
}

function emptyFields(): InstantlyEmailReadReport["fields"] {
  const blank = { present: false, type: "absent" as const, length: null };
  return {
    id: blank,
    thread_id: blank,
    subject: blank,
    eaccount: blank,
    lead: blank,
    campaign_id: blank,
    timestamp_email: blank,
    body: blank,
  };
}

export function emptyInstantlyEmailReadReport(): InstantlyEmailReadReport {
  return {
    emailRead: "unknown",
    emailReadStatus: null,
    replyPermission: "unknown",
    replyPermissionStatus: null,
    receivedCount: 0,
    exactReplyTarget: false,
    fullTextAvailable: null,
    bodyTextLength: null,
    bodyHtmlPresent: null,
    bodyFallback: null,
    threadIdPresent: false,
    receivedType: null,
    fields: emptyFields(),
    providerError: null,
  };
}

export function sanitizeProviderError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/bearer\s+\S+/i.test(value)) return null;
  const cleaned = value
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!cleaned || /sk-|api[_-]?key|eyJ|token/i.test(cleaned)) return null;
  return cleaned;
}

function providerErrorFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  return sanitizeProviderError(row.message) ?? sanitizeProviderError(row.error);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fallbackReason(value: unknown): "too_large" | "unavailable" | null {
  return value === "too_large" || value === "unavailable" ? value : null;
}

function applyItem(report: InstantlyEmailReadReport, item: Record<string, unknown>): void {
  report.fields = {
    id: fieldReport(item, "id"),
    thread_id: fieldReport(item, "thread_id"),
    subject: fieldReport(item, "subject"),
    eaccount: fieldReport(item, "eaccount"),
    lead: fieldReport(item, "lead"),
    campaign_id: fieldReport(item, "campaign_id"),
    timestamp_email: fieldReport(item, "timestamp_email"),
    body: fieldReport(item, "body"),
  };
  report.exactReplyTarget = exactReplyTargetAvailable(item.id);
  report.threadIdPresent = exactReplyTargetAvailable(item.thread_id);
  report.receivedType = typeof item.ue_type === "number" ? item.ue_type : null;
  const body = item.body && typeof item.body === "object" && !Array.isArray(item.body)
    ? item.body as Record<string, unknown>
    : null;
  const text = body && typeof body.text === "string" ? body.text : null;
  report.bodyTextLength = text === null ? null : text.length;
  report.bodyHtmlPresent = Boolean(body && typeof body.html === "string" && body.html.length > 0);
  report.bodyFallback = fallbackReason(item.body_fallback_reason);
  report.fullTextAvailable = text !== null && text.length > 0 && report.bodyFallback === null;
}

function replyPermissionFromScopes(scopes: unknown): InstantlyAccess {
  if (!Array.isArray(scopes)) return "unknown";
  const names = scopes.filter((scope): scope is string => typeof scope === "string" && SCOPE_NAME.test(scope));
  if (names.length === 0 && scopes.length > 0) return "unknown";
  return names.some((scope) => CREATE_SCOPES.has(scope)) ? "verified" : "denied";
}

export async function readInstantlyReceivedEmailDiagnostic(args: {
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}): Promise<InstantlyEmailReadReport> {
  const report = emptyInstantlyEmailReadReport();
  const apiKey = args.apiKey?.trim() ?? "";
  if (!apiKey) {
    report.providerError = "missing_credentials";
    return report;
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  let listed: Response;
  try {
    listed = await fetchImpl(INSTANTLY_EMAIL_LIST_URL, { method: "GET", headers });
  } catch {
    report.providerError = "timeout_or_network";
    return report;
  }
  report.emailReadStatus = listed.status;
  const listedPayload = await readJson(listed);
  if (listed.status === 401 || listed.status === 403) {
    report.emailRead = "denied";
    report.providerError = providerErrorFrom(listedPayload);
  } else if (!listed.ok) {
    report.providerError = providerErrorFrom(listedPayload) ?? "provider_error";
    return report;
  } else if (!listedPayload || typeof listedPayload !== "object" || Array.isArray(listedPayload) || !Array.isArray((listedPayload as { items?: unknown }).items)) {
    report.providerError = "unreadable_response";
    return report;
  } else {
    const items = (listedPayload as { items: unknown[] }).items;
    report.emailRead = "verified";
    report.receivedCount = items.length;
    const first = items.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
    if (first) {
      applyItem(report, first);
      if (report.bodyFallback && typeof first.id === "string" && SAFE_ID.test(first.id)) {
        try {
          const full = await fetchImpl(`https://api.instantly.ai/api/v2/emails/${encodeURIComponent(first.id)}`, {
            method: "GET",
            headers,
          });
          if (full.ok) {
            const payload = await readJson(full);
            if (payload && typeof payload === "object" && !Array.isArray(payload)) applyItem(report, payload as Record<string, unknown>);
          }
        } catch {
          report.fullTextAvailable = null;
        }
      }
    }
  }

  let keys: Response;
  try {
    keys = await fetchImpl(INSTANTLY_API_KEYS_URL, { method: "GET", headers });
  } catch {
    return report;
  }
  report.replyPermissionStatus = keys.status;
  const keysPayload = await readJson(keys);
  if (keys.status === 401 || keys.status === 403 || !keys.ok) return report;
  const rows = keysPayload && typeof keysPayload === "object" && !Array.isArray(keysPayload)
    ? (keysPayload as { items?: unknown }).items
    : null;
  if (!Array.isArray(rows)) return report;
  const match = rows.find((row) => row && typeof row === "object" && !Array.isArray(row) && (row as { key?: unknown }).key === apiKey) as { scopes?: unknown } | undefined;
  if (!match) return report;
  report.replyPermission = replyPermissionFromScopes(match.scopes);
  return report;
}

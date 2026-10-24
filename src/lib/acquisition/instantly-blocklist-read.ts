/**
 * Temporary owner-only read of the Instantly workspace blocklist.
 * Delete this module and src/app/api/admin/acquisition/instantly-blocklist-read/route.ts
 * after the approved production check.
 * This module sends one GET. It does not create, edit, or delete entries.
 */

import { INSTANTLY_BLOCK_LIST_URL } from "@/lib/acquisition/instantly-block";

export const INSTANTLY_BLOCKLIST_READ_URL = `${INSTANTLY_BLOCK_LIST_URL}?limit=100`;
export const INSTANTLY_BLOCKLIST_READ_LIMIT = 100;

export type InstantlyBlocklistReadAccess = "verified" | "denied" | "unknown";

export type InstantlyBlocklistReadReport = {
  access: InstantlyBlocklistReadAccess;
  httpStatus: number | null;
  entryCount: number;
  responseValid: boolean;
  limit: number;
  pageFull: boolean;
  nextPagePresent: boolean;
  providerError: string | null;
};

export function emptyInstantlyBlocklistReadReport(
  providerError: string | null = null,
): InstantlyBlocklistReadReport {
  return {
    access: "unknown",
    httpStatus: null,
    entryCount: 0,
    responseValid: false,
    limit: INSTANTLY_BLOCKLIST_READ_LIMIT,
    pageFull: false,
    nextPagePresent: false,
    providerError,
  };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function listFrom(payload: unknown): {
  items: unknown[];
  responseValid: boolean;
  nextPagePresent: boolean;
} | null {
  if (!plainObject(payload) || !Array.isArray(payload.items)) return null;
  const items = payload.items;
  const next = payload.next_starting_after;
  return {
    items,
    responseValid: items.every((item) => plainObject(item)),
    nextPagePresent: typeof next === "string" && next.length > 0,
  };
}

export async function readInstantlyBlocklistDiagnostic(args: {
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}): Promise<InstantlyBlocklistReadReport> {
  const apiKey = args.apiKey?.trim() ?? "";
  if (!apiKey) return emptyInstantlyBlocklistReadReport("missing_credentials");
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(INSTANTLY_BLOCKLIST_READ_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    return emptyInstantlyBlocklistReadReport("timeout_or_network");
  }

  const report = emptyInstantlyBlocklistReadReport();
  report.httpStatus = response.status;
  if (response.status === 401 || response.status === 403) {
    report.access = "denied";
    report.providerError = "permission_denied";
    return report;
  }
  if (response.status === 429) {
    report.providerError = "rate_limited";
    return report;
  }
  if (response.status === 400 || response.status === 402 || response.status === 404) {
    report.providerError = "provider_rejected";
    return report;
  }
  if (response.status === 504 || response.status >= 500) {
    report.providerError = "timeout_or_network";
    return report;
  }
  if (response.status !== 200) {
    report.providerError = "unreadable_response";
    return report;
  }

  const listed = listFrom(await readJson(response));
  if (!listed) {
    report.providerError = "unreadable_response";
    return report;
  }
  report.access = "verified";
  report.entryCount = listed.items.length;
  report.responseValid = listed.responseValid;
  report.pageFull = listed.items.length >= INSTANTLY_BLOCKLIST_READ_LIMIT;
  report.nextPagePresent = listed.nextPagePresent;
  report.providerError = null;
  return report;
}

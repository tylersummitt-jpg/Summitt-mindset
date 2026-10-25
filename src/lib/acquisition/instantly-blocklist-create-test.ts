/**
 * Temporary one-address Instantly blocklist create test.
 * Delete this module, instantly-blocklist-create-test.server.ts, the route, and
 * supabase/migrations/20261024200000_acquisition_blocklist_create_test.sql
 * after the owner-approved test.
 * This module sends at most one POST. It does not drain stop intents.
 */

import {
  exactEmailBlockEntry,
  INSTANTLY_BLOCK_LIST_URL,
  matchBlockListEntry,
} from "@/lib/acquisition/instantly-block";
import { normalizeAcquisitionEmail } from "@/lib/acquisition/model";

export const BLOCKLIST_CREATE_TEST_CONFIRM = "create-one-email-block";
export const BLOCKLIST_CREATE_TEST_ALLOWLIST_ENV = "INSTANTLY_BLOCKLIST_CREATE_TEST_EMAIL";

export type BlocklistCreateTestVerdict =
  | "invalid_request"
  | "not_allowlisted"
  | "local_intent_exists"
  | "local_unreadable"
  | "already_present"
  | "preflight_blocked"
  | "already_used"
  | "single_use_unavailable"
  | "missing_credentials"
  | "created"
  | "denied"
  | "uncertain";

export type BlocklistCreateTestReport = {
  verdict: BlocklistCreateTestVerdict;
  httpStatus: number | null;
  posted: boolean;
};

export type BlocklistCreateTestOutcome = "created" | "denied" | "uncertain";

function report(
  verdict: BlocklistCreateTestVerdict,
  httpStatus: number | null,
  posted: boolean,
): BlocklistCreateTestReport {
  return { verdict, httpStatus, posted };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestEmail(body: unknown): string | "invalid" {
  if (!plainObject(body)) return "invalid";
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "confirm" || keys[1] !== "email") return "invalid";
  if (body.confirm !== BLOCKLIST_CREATE_TEST_CONFIRM) return "invalid";
  if (typeof body.email !== "string") return "invalid";
  return normalizeAcquisitionEmail(body.email) ?? "invalid";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function preflightDecision(payload: unknown, email: string): "present" | "absent" | "blocked" {
  if (!plainObject(payload) || !Array.isArray(payload.items)) return "blocked";
  const listed = matchBlockListEntry(payload, email);
  if (listed.id) return "present";
  if (listed.truncated || payload.items.length >= 100) return "blocked";
  return "absent";
}

export async function runInstantlyBlocklistCreateTest(args: {
  body: unknown;
  apiKey: string | null;
  allowlist: string | null;
  fetchImpl?: typeof fetch;
  findLocalIntent: (email: string) => Promise<"present" | "absent" | "unreadable">;
  readClaim: () => Promise<"present" | "absent" | "unreadable">;
  claimOnce: () => Promise<"claimed" | "used" | "unavailable">;
  recordOutcome: (outcome: BlocklistCreateTestOutcome) => Promise<void>;
}): Promise<BlocklistCreateTestReport> {
  const email = requestEmail(args.body);
  if (email === "invalid") return report("invalid_request", null, false);

  const allowlist = normalizeAcquisitionEmail(args.allowlist);
  if (!allowlist || allowlist !== email) return report("not_allowlisted", null, false);

  const local = await args.findLocalIntent(email);
  if (local === "present") return report("local_intent_exists", null, false);
  if (local === "unreadable") return report("local_unreadable", null, false);

  const existingClaim = await args.readClaim();
  if (existingClaim === "present") return report("already_used", null, false);
  if (existingClaim === "unreadable") return report("single_use_unavailable", null, false);

  const apiKey = args.apiKey?.trim() ?? "";
  if (!apiKey) return report("missing_credentials", null, false);

  const fetchImpl = args.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  const searchUrl = `${INSTANTLY_BLOCK_LIST_URL}?limit=100&search=${encodeURIComponent(email)}`;
  let listed: Response;
  try {
    listed = await fetchImpl(searchUrl, { method: "GET", headers });
  } catch {
    return report("preflight_blocked", null, false);
  }
  if (listed.status !== 200) return report("preflight_blocked", listed.status, false);
  const decision = preflightDecision(await readJson(listed), email);
  if (decision === "present") return report("already_present", listed.status, false);
  if (decision === "blocked") return report("preflight_blocked", listed.status, false);

  let claim: "claimed" | "used" | "unavailable";
  try {
    claim = await args.claimOnce();
  } catch {
    return report("single_use_unavailable", null, false);
  }
  if (claim === "used") return report("already_used", null, false);
  if (claim !== "claimed") return report("single_use_unavailable", null, false);

  let created: Response;
  try {
    created = await fetchImpl(INSTANTLY_BLOCK_LIST_URL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ bl_value: email }),
    });
  } catch {
    await args.recordOutcome("uncertain").catch(() => undefined);
    return report("uncertain", null, true);
  }

  const outcome = createOutcome(created.status, await readJson(created), email);
  await args.recordOutcome(outcome).catch(() => undefined);
  return report(outcome, created.status, true);
}

function createOutcome(
  status: number,
  payload: unknown,
  email: string,
): BlocklistCreateTestOutcome {
  if (status === 401 || status === 403) return "denied";
  if (status === 200 && exactEmailBlockEntry(payload, email)) return "created";
  return "uncertain";
}

import type { NextResponse } from "next/server";

import { CHECKOUT_ACTIVATE_TRACE_HEADER } from "@/lib/stripe-first-checkout/constants";

const TRACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_RE = /^[a-z_]{1,40}$/;
const FAILURE_CATEGORIES = new Set([
  "retry",
  "rejected",
  "refused",
  "exception",
  "unexpected",
]);

export type ActivateTraceRecord = {
  trace: string;
  http: number;
  category: string;
  error?: string;
};

export function createActivateTraceId(): string {
  return crypto.randomUUID();
}

/** Keeps the Vercel line to a status, a category, and an allowlisted failure. */
export function activateTraceRecord(args: {
  traceId: string;
  http: number;
  category: string;
  error?: string;
}): ActivateTraceRecord {
  const http =
    Number.isInteger(args.http) && args.http >= 100 && args.http <= 599 ? args.http : 0;
  const record: ActivateTraceRecord = {
    trace: TRACE_ID_RE.test(args.traceId) ? args.traceId : "invalid",
    http,
    category: CATEGORY_RE.test(args.category) ? args.category : "unexpected",
  };
  if (args.error) {
    record.error = FAILURE_CATEGORIES.has(args.error) ? args.error : "unexpected";
  }
  return record;
}

function writeActivateTrace(record: ActivateTraceRecord): void {
  console.error("[stripe-first] activate trace", record);
}

/**
 * Logs the response the route is about to send and stamps its correlation id.
 * A logging or header failure returns the same response object.
 */
export function deliverActivateResponse(args: {
  traceId: string;
  response: NextResponse;
  category: string;
  error?: string;
}): NextResponse {
  try {
    const trace = TRACE_ID_RE.test(args.traceId) ? args.traceId : null;
    if (trace) args.response.headers.set(CHECKOUT_ACTIVATE_TRACE_HEADER, trace);
  } catch {
    // The checkout response must not depend on the diagnostic header.
  }
  try {
    writeActivateTrace(
      activateTraceRecord({
        traceId: args.traceId,
        http: args.response.status,
        category: args.category,
        error: args.error,
      })
    );
  } catch {
    // The checkout response must not depend on logging.
  }
  return args.response;
}

export function logActivateException(traceId: string): void {
  try {
    writeActivateTrace(
      activateTraceRecord({
        traceId,
        http: 500,
        category: "exception",
        error: "exception",
      })
    );
  } catch {
    // The original exception must still propagate.
  }
}

/** One correlation id for the request. Exceptions are logged and rethrown. */
export async function withActivateTrace(
  run: (traceId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  let traceId = "invalid";
  try {
    traceId = createActivateTraceId();
    return await run(traceId);
  } catch (err) {
    logActivateException(traceId);
    throw err;
  }
}

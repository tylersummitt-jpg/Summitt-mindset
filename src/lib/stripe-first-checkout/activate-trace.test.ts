import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_ACTIVATE_TRACE_HEADER } from "@/lib/stripe-first-checkout/constants";
import {
  activateTraceRecord,
  createActivateTraceId,
  deliverActivateResponse,
  withActivateTrace,
} from "@/lib/stripe-first-checkout/activate-trace";

const SECRET_MESSAGE = "cs_live_secret_session member@example.com tkt_secret sk_live_secret";

describe("activate trace record", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a failure category and drops anything outside the allowlist", () => {
    expect(
      activateTraceRecord({
        traceId: "11111111-1111-4111-8111-111111111111",
        http: 503,
        category: "retry",
        error: "retry",
      })
    ).toEqual({
      trace: "11111111-1111-4111-8111-111111111111",
      http: 503,
      category: "retry",
      error: "retry",
    });

    const leaked = activateTraceRecord({
      traceId: SECRET_MESSAGE,
      http: 200,
      category: SECRET_MESSAGE,
      error: SECRET_MESSAGE,
    });
    expect(leaked).toEqual({
      trace: "invalid",
      http: 200,
      category: "unexpected",
      error: "unexpected",
    });
    expect(JSON.stringify(leaked)).not.toContain("cs_live");
    expect(JSON.stringify(leaked)).not.toContain("member@");
    expect(JSON.stringify(leaked)).not.toContain("tkt_secret");
    expect(JSON.stringify(leaked)).not.toContain("sk_live");
  });

  it("gives simultaneous requests different correlation ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => createActivateTraceId()));
    expect(ids.size).toBe(20);
  });

  it("still returns the checkout response when logging or the header fails", async () => {
    const ticket = { status: "ticket", ticket: "tkt_secret_ticket_value" };
    const response = NextResponse.json(ticket, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("log down");
    });
    vi.spyOn(response.headers, "set").mockImplementation(() => {
      throw new Error("header down");
    });

    const returned = deliverActivateResponse({
      traceId: createActivateTraceId(),
      response,
      category: "ticket",
    });

    expect(returned).toBe(response);
    expect(returned.status).toBe(200);
    expect(returned.headers.get("cache-control")).toBe("no-store");
    expect(await returned.json()).toEqual(ticket);
  });

  it("logs an exception without the thrown message and then rethrows it", async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((_message, record) => {
      logs.push(record);
    });

    await expect(
      withActivateTrace(async () => {
        throw new Error(SECRET_MESSAGE);
      })
    ).rejects.toThrow(SECRET_MESSAGE);

    expect(logs).toEqual([
      {
        trace: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        http: 500,
        category: "exception",
        error: "exception",
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("cs_live");
    expect(JSON.stringify(logs)).not.toContain("member@");
    expect(JSON.stringify(logs)).not.toContain("tkt_secret");
    expect(JSON.stringify(logs)).not.toContain("sk_live");
  });

  it("rethrows the original exception when the exception log itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("log down");
    });
    await expect(
      withActivateTrace(async () => {
        throw new Error("activate_failed");
      })
    ).rejects.toThrow("activate_failed");
  });

  it("does not import Stripe, Clerk, or a new store", () => {
    const source = readFileSync("src/lib/stripe-first-checkout/activate-trace.ts", "utf8");
    const constants = readFileSync("src/lib/stripe-first-checkout/constants.ts", "utf8");
    expect(source).toContain("CHECKOUT_ACTIVATE_TRACE_HEADER");
    expect(constants).toContain(`export const CHECKOUT_ACTIVATE_TRACE_HEADER = "${CHECKOUT_ACTIVATE_TRACE_HEADER}"`);
    expect(source).not.toContain("stripeClient");
    expect(source).not.toContain("@clerk");
    expect(source).not.toContain("supabase");
    expect(source).not.toContain("sessionId");
    expect(source).not.toContain('from "node:crypto"');
    expect(source).not.toContain('from "crypto"');
    expect(source).toContain("crypto.randomUUID()");
  });
});

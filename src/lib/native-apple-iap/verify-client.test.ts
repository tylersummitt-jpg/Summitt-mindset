import { describe, expect, it, vi } from "vitest";
import {
  fetchAppleAccountToken,
  postAppleSignedTransaction,
  shouldAckNativeTransactionFinish,
} from "./verify-client";

describe("Apple IAP web verify client", () => {
  it("GET /api/apple/account-token with same-origin cookies", async () => {
    const fetcher = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      expect(input).toBe("/api/apple/account-token");
      expect(init?.method).toBe("GET");
      expect(init?.credentials).toBe("same-origin");
      return new Response(
        JSON.stringify({ appAccountToken: "550e8400-e29b-41d4-a716-446655440000" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const result = await fetchAppleAccountToken(fetcher);
    expect(result).toEqual({
      ok: true,
      appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("POST /api/apple/verify with signedTransactionInfo only", async () => {
    const fetcher = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      expect(input).toBe("/api/apple/verify");
      expect(init?.credentials).toBe("same-origin");
      expect(JSON.parse(String(init?.body))).toEqual({
        signedTransactionInfo: "header.payload.sig",
      });
      expect(String(init?.body)).not.toContain("userId");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      postAppleSignedTransaction("header.payload.sig", fetcher)
    ).resolves.toEqual({ kind: "verified" });
  });

  it("200 acks finish; 500/409 do not", () => {
    expect(shouldAckNativeTransactionFinish({ kind: "verified" })).toBe(true);
    expect(shouldAckNativeTransactionFinish({ kind: "retryable" })).toBe(false);
    expect(shouldAckNativeTransactionFinish({ kind: "conflict" })).toBe(false);
    expect(shouldAckNativeTransactionFinish({ kind: "rejected" })).toBe(false);
  });

  it("maps HTTP statuses", async () => {
    const statusFetch = (status: number) =>
      (async () =>
        new Response("{}", { status })) as unknown as typeof fetch;
    await expect(
      postAppleSignedTransaction("jws", statusFetch(409))
    ).resolves.toEqual({ kind: "conflict" });
    await expect(
      postAppleSignedTransaction("jws", statusFetch(500))
    ).resolves.toEqual({ kind: "retryable" });
    await expect(
      postAppleSignedTransaction("jws", statusFetch(400))
    ).resolves.toEqual({ kind: "rejected" });
  });
});

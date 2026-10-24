import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { INSTANTLY_BLOCK_LIST_URL } from "@/lib/acquisition/instantly-block";
import {
  INSTANTLY_BLOCKLIST_READ_URL,
  readInstantlyBlocklistDiagnostic,
} from "@/lib/acquisition/instantly-blocklist-read";

const { ownerSession } = vi.hoisted(() => ({
  ownerSession: vi.fn(),
}));

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  isTylerOwnerSession: ownerSession,
}));

import { GET } from "@/app/api/admin/acquisition/instantly-blocklist-read/route";

const SECRET_EMAIL = "coach@example.com";
const SECRET_DOMAIN = "blocked-school.edu";
const SECRET_ID = "entry-9f3c";
const SECRET_TOKEN = "super-secret-token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function poisonousList(count = 2, next = SECRET_ID) {
  return {
    items: Array.from({ length: count }, () => ({
      id: SECRET_ID,
      organization_id: "org-secret",
      bl_value: count === 1 ? SECRET_DOMAIN : SECRET_EMAIL,
      is_domain: count === 1,
    })),
    next_starting_after: next,
    message: `Bearer ${SECRET_TOKEN} ${SECRET_EMAIL}`,
  };
}

function expectRedacted(report: unknown) {
  const text = JSON.stringify(report);
  expect(text).not.toContain(SECRET_EMAIL);
  expect(text).not.toContain(SECRET_DOMAIN);
  expect(text).not.toContain(SECRET_ID);
  expect(text).not.toContain(SECRET_TOKEN);
  expect(text).not.toContain("Bearer");
  expect(text).not.toContain("org-secret");
  expect(text).not.toContain("@");
}

afterEach(() => {
  ownerSession.mockReset();
  delete process.env.INSTANTLY_API_KEY;
  vi.unstubAllGlobals();
});

describe("temporary Instantly blocklist read", () => {
  it("requires Tyler's owner session and does not call Instantly otherwise", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchImpl);
    ownerSession.mockResolvedValue(false);
    const denied = await GET();
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();

    ownerSession.mockResolvedValue(true);
    process.env.INSTANTLY_API_KEY = "diagnostic-test-key";
    const allowed = await GET();
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body).toMatchObject({
      access: "verified",
      httpStatus: 200,
      entryCount: 0,
      responseValid: true,
    });
    expect(JSON.stringify(body)).not.toContain("diagnostic-test-key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INSTANTLY_BLOCKLIST_READ_URL);
    expect(init.method).toBe("GET");
    expect(JSON.stringify(init.headers)).toContain("diagnostic-test-key");

    const route = readFileSync("src/app/api/admin/acquisition/instantly-blocklist-read/route.ts", "utf8");
    expect(route).toContain("isTylerOwnerSession");
    expect(route).not.toContain("requireTylerAdmin");
    expect(route).not.toContain("searchParams");
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("reads one fixed blocklist page and redacts every provider value", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, poisonousList(2, SECRET_ID)));
    const report = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(report).toEqual({
      access: "verified",
      httpStatus: 200,
      entryCount: 2,
      responseValid: true,
      limit: 100,
      pageFull: false,
      nextPagePresent: true,
      providerError: null,
    });
    expectRedacted(report);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(INSTANTLY_BLOCK_LIST_URL);
    expect(url).toBe(INSTANTLY_BLOCKLIST_READ_URL);
    expect([...parsed.searchParams.keys()]).toEqual(["limit"]);
    expect(parsed.searchParams.get("limit")).toBe("100");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("treats an empty valid page as read access and a full page as incomplete", async () => {
    const empty = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(200, { items: [] })) as typeof fetch,
    });
    expect(empty).toMatchObject({
      access: "verified",
      httpStatus: 200,
      entryCount: 0,
      responseValid: true,
      pageFull: false,
      nextPagePresent: false,
    });

    const full = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(200, poisonousList(100, ""))) as typeof fetch,
    });
    expect(full.access).toBe("verified");
    expect(full.entryCount).toBe(100);
    expect(full.pageFull).toBe(true);
    expect(full.nextPagePresent).toBe(false);
    expectRedacted(full);
  });

  it("reports permission denial without copying the provider body", async () => {
    for (const status of [401, 403]) {
      const report = await readInstantlyBlocklistDiagnostic({
        apiKey: "diagnostic-test-key",
        fetchImpl: (async () => jsonResponse(status, poisonousList())) as typeof fetch,
      });
      expect(report).toMatchObject({
        access: "denied",
        httpStatus: status,
        entryCount: 0,
        responseValid: false,
        providerError: "permission_denied",
      });
      expectRedacted(report);
    }
  });

  it("reports provider and network failures without a second request", async () => {
    const missing = await readInstantlyBlocklistDiagnostic({
      apiKey: "  ",
      fetchImpl: vi.fn() as typeof fetch,
    });
    expect(missing).toMatchObject({ access: "unknown", httpStatus: null, providerError: "missing_credentials" });

    const thrown = vi.fn(async () => {
      throw new Error(`network ${SECRET_EMAIL}`);
    });
    const offline = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: thrown as typeof fetch,
    });
    expect(offline).toMatchObject({ access: "unknown", httpStatus: null, providerError: "timeout_or_network" });
    expect(thrown).toHaveBeenCalledTimes(1);
    expectRedacted(offline);

    const limited = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(429, { message: SECRET_EMAIL })) as typeof fetch,
    });
    expect(limited).toMatchObject({ httpStatus: 429, access: "unknown", providerError: "rate_limited", entryCount: 0 });
    expectRedacted(limited);

    const rejected = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(400, { error: SECRET_DOMAIN })) as typeof fetch,
    });
    expect(rejected.providerError).toBe("provider_rejected");
    expectRedacted(rejected);

    const down = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => new Response("upstream", { status: 504 })) as typeof fetch,
    });
    expect(down).toMatchObject({ httpStatus: 504, access: "unknown", providerError: "timeout_or_network" });

    const unreadable = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(200, { message: SECRET_EMAIL })) as typeof fetch,
    });
    expect(unreadable).toMatchObject({
      access: "unknown",
      httpStatus: 200,
      entryCount: 0,
      responseValid: false,
      providerError: "unreadable_response",
    });
    expectRedacted(unreadable);

    const broken = await readInstantlyBlocklistDiagnostic({
      apiKey: "diagnostic-test-key",
      fetchImpl: (async () => jsonResponse(200, { items: [SECRET_EMAIL], next_starting_after: SECRET_ID })) as typeof fetch,
    });
    expect(broken).toMatchObject({
      access: "verified",
      httpStatus: 200,
      entryCount: 1,
      responseValid: false,
      nextPagePresent: true,
      providerError: null,
    });
    expectRedacted(broken);

    const source = readFileSync("src/lib/acquisition/instantly-blocklist-read.ts", "utf8");
    expect(source).toContain('method: "GET"');
    expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(source).not.toContain("search=");
    expect(source).not.toContain("starting_after=");
  });
});

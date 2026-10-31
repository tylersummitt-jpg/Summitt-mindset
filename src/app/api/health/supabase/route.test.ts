import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteMatcher } from "@clerk/nextjs/server";

const connectionMock = vi.hoisted(() => vi.fn(async () => {}));
const fromMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const limitMock = vi.hoisted(() => vi.fn());
const abortSignalMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, connection: connectionMock };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => fromMock(table),
  },
}));

import { GET, HEAD } from "@/app/api/health/supabase/route";

const ROOT = process.cwd();
const ROUTE_SRC = readFileSync(join(ROOT, "src/app/api/health/supabase/route.ts"), "utf8");
const MIDDLEWARE_SRC = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
const SECRET_ID = "film-secret-id";
const SECRET_ERROR = "postgres down at https://secret-project.supabase.co token=service-role-key";

function queryResult(result: unknown) {
  abortSignalMock.mockResolvedValue(result);
  limitMock.mockReturnValue({ abortSignal: abortSignalMock });
  selectMock.mockReturnValue({ limit: limitMock });
  fromMock.mockReturnValue({
    select: selectMock,
    insert: () => {
      throw new Error("health check must not insert");
    },
    update: () => {
      throw new Error("health check must not update");
    },
    delete: () => {
      throw new Error("health check must not delete");
    },
    rpc: () => {
      throw new Error("health check must not call rpc");
    },
  });
}

function middlewarePublicRoutePatterns(): string[] {
  const block = MIDDLEWARE_SRC.match(/createRouteMatcher\(\[([\s\S]*?)\]\)/);
  expect(block).not.toBeNull();
  return [...(block![1].matchAll(/"([^"]+)"/g))].map((match) => match[1]);
}

async function expectUnhealthy(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const text = await response.text();
  expect(text).toBe('{"ok":false}');
  expect(text).not.toContain(SECRET_ID);
  expect(text).not.toContain("supabase.co");
  expect(text).not.toContain("service-role");
  expect(Object.keys(JSON.parse(text) as object)).toEqual(["ok"]);
}

describe("GET /api/health/supabase", () => {
  beforeEach(() => {
    connectionMock.mockClear();
    fromMock.mockReset();
    selectMock.mockReset();
    limitMock.mockReset();
    abortSignalMock.mockReset();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 for a row and does not expose the id", async () => {
    queryResult({ data: [{ id: SECRET_ID }], error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toBe('{"ok":true}');
    expect(text).not.toContain(SECRET_ID);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("film_videos");
    expect(selectMock).toHaveBeenCalledWith("id");
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(4000);
    expect(abortSignalMock).toHaveBeenCalledTimes(1);
    expect(connectionMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for an empty table", async () => {
    queryResult({ data: [], error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 503 for a database error and hides the upstream message", async () => {
    queryResult({ data: [{ id: SECRET_ID }], error: { message: SECRET_ERROR, code: "XX000" } });
    await expectUnhealthy(await GET());
  });

  it("returns 503 when the query times out", async () => {
    queryResult({
      data: null,
      error: { message: `AbortError: ${SECRET_ERROR}`, code: "" },
    });
    await expectUnhealthy(await GET());
  });

  it("returns 503 when the query throws", async () => {
    queryResult({ data: [], error: null });
    abortSignalMock.mockRejectedValue(new Error(SECRET_ERROR));
    await expectUnhealthy(await GET());
  });

  it("returns 503 for malformed results", async () => {
    for (const data of [null, { id: SECRET_ID }, SECRET_ID, undefined]) {
      queryResult({ data, error: null });
      await expectUnhealthy(await GET());
    }
  });

  it("runs the same check for HEAD", async () => {
    queryResult({ data: [{ id: SECRET_ID }], error: null });
    const response = await HEAD();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(fromMock).toHaveBeenCalledWith("film_videos");

    queryResult({ data: null, error: { message: SECRET_ERROR } });
    await expectUnhealthy(await HEAD());
  });
});

describe("supabase health middleware exception", () => {
  it("publishes only the exact path and leaves child paths protected", () => {
    const patterns = middlewarePublicRoutePatterns();
    expect(patterns).toContain("/api/health/supabase");
    expect(patterns.filter((pattern) => pattern.includes("/api/health"))).toEqual([
      "/api/health/supabase",
    ]);
    expect(patterns.some((pattern) => pattern === "/api/health(.*)" || pattern === "/api/health/*")).toBe(
      false
    );

    const isPublicRoute = createRouteMatcher(patterns);
    const req = (path: string) =>
      ({ nextUrl: { pathname: path } }) as Parameters<typeof isPublicRoute>[0];

    expect(isPublicRoute(req("/api/health/supabase"))).toBe(true);
    expect(isPublicRoute(req("/api/health/supabase/extra"))).toBe(false);
    expect(isPublicRoute(req("/api/health"))).toBe(false);
    expect(isPublicRoute(req("/api/health/supabase-other"))).toBe(false);
    expect(isPublicRoute(req("/admin"))).toBe(false);
    expect(isPublicRoute(req("/dashboard"))).toBe(false);
    expect(isPublicRoute(req("/api/cron/daily-sms"))).toBe(true);
    expect(isPublicRoute(req("/api/stripe/webhook"))).toBe(true);
    expect(isPublicRoute(req("/api/apple/webhook"))).toBe(true);
  });

  it("skips marketing cookies and does not change the Clerk matcher", () => {
    const early = MIDDLEWARE_SRC.indexOf('req.nextUrl.pathname === "/api/health/supabase"');
    const cookies = MIDDLEWARE_SRC.indexOf("return attachMarketingCookies(req, res);");
    expect(early).toBeGreaterThan(-1);
    expect(cookies).toBeGreaterThan(early);
    expect(MIDDLEWARE_SRC).not.toContain('pathname.startsWith("/api/health');
    expect(MIDDLEWARE_SRC).toContain('matcher: ["/((?!_next|.*\\\\..*).*)"]');
    expect(ROUTE_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(ROUTE_SRC).toContain("export const revalidate = 0");
    expect(ROUTE_SRC).toContain('export const fetchCache = "force-no-store"');
    expect(ROUTE_SRC).toContain('from("film_videos")');
    expect(ROUTE_SRC).toContain('.select("id")');
    expect(ROUTE_SRC).toContain(".limit(1)");
    expect(ROUTE_SRC).toContain("AbortSignal.timeout(4000)");
    expect(ROUTE_SRC).not.toMatch(/\.insert\s*\(/);
    expect(ROUTE_SRC).not.toMatch(/\.update\s*\(/);
    expect(ROUTE_SRC).not.toMatch(/\.delete\s*\(/);
    expect(ROUTE_SRC).not.toMatch(/\.rpc\s*\(/);
    expect(ROUTE_SRC).not.toContain("auth(");
    expect(ROUTE_SRC).not.toContain("error.message");
    expect(ROUTE_SRC).not.toContain("SUPABASE");
  });
});

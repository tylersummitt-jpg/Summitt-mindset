import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRouteMatcher } from "@clerk/nextjs/server";

const ROOT = process.cwd();

function middlewarePublicRoutePatterns(): string[] {
  const src = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
  const block = src.match(/createRouteMatcher\(\[([\s\S]*?)\]\)/);
  expect(block).not.toBeNull();
  return [...(block![1].matchAll(/"([^"]+)"/g))].map((match) => match[1]);
}

describe("recovery inbound webhook exposure", () => {
  it("opens only the exact inbound and unsubscribe routes", () => {
    const patterns = middlewarePublicRoutePatterns();
    expect(patterns).toContain("/api/recovery/inbound");
    expect(patterns).toContain("/api/recovery/unsubscribe");
    expect(patterns.some((pattern) => pattern === "/api/recovery(.*)" || pattern === "/api/recovery/*")).toBe(false);

    const isPublicRoute = createRouteMatcher(patterns);
    const req = (path: string) =>
      ({ nextUrl: { pathname: path } }) as Parameters<typeof isPublicRoute>[0];

    expect(isPublicRoute(req("/api/recovery/inbound"))).toBe(true);
    expect(isPublicRoute(req("/api/recovery/inbound/extra"))).toBe(false);
    expect(isPublicRoute(req("/api/recovery/unsubscribe"))).toBe(true);
    expect(isPublicRoute(req("/api/recovery/unsubscribe/extra"))).toBe(false);
    expect(isPublicRoute(req("/api/recovery"))).toBe(false);
    expect(isPublicRoute(req("/admin"))).toBe(false);
    expect(isPublicRoute(req("/admin/distribution"))).toBe(false);

    const admin = readFileSync(join(ROOT, "src/app/admin/layout.tsx"), "utf8");
    expect(admin).toContain("requireTylerAdmin()");
    const unsubscribe = readFileSync(join(ROOT, "src/app/api/recovery/unsubscribe/route.ts"), "utf8");
    expect(unsubscribe).toContain("This unsubscribe link is not valid.");
    expect(unsubscribe).not.toContain("auth()");
  });
});

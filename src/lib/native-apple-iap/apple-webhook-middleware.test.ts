import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRouteMatcher } from "@clerk/nextjs/server";

const ROOT = process.cwd();
const MIDDLEWARE = join(ROOT, "src/middleware.ts");

function middlewarePublicRoutePatterns(): string[] {
  const src = readFileSync(MIDDLEWARE, "utf8");
  const block = src.match(/createRouteMatcher\(\[([\s\S]*?)\]\)/);
  expect(block).not.toBeNull();
  return [...(block![1].matchAll(/"([^"]+)"/g))].map((m) => m[1]);
}

describe("Apple IAP middleware exposure", () => {
  it("makes /api/apple/webhook public like Stripe webhook", () => {
    const patterns = middlewarePublicRoutePatterns();
    expect(patterns).toContain("/api/apple/webhook");
    expect(patterns).toContain("/api/stripe/webhook(.*)");
    expect(patterns).not.toContain("/api/apple/verify");
    expect(patterns).not.toContain("/api/apple/account-token");
    expect(patterns.some((p) => p.includes("/api/apple/verify"))).toBe(false);
    expect(patterns.some((p) => p.includes("/api/apple/account-token"))).toBe(
      false
    );
    expect(patterns.some((p) => p === "/api/apple(.*)")).toBe(false);

    const isPublicRoute = createRouteMatcher(patterns);
    const req = (path: string) =>
      ({
        nextUrl: { pathname: path },
      }) as Parameters<typeof isPublicRoute>[0];

    expect(isPublicRoute(req("/api/apple/webhook"))).toBe(true);
    expect(isPublicRoute(req("/api/apple/verify"))).toBe(false);
    expect(isPublicRoute(req("/api/apple/account-token"))).toBe(false);
    expect(isPublicRoute(req("/api/stripe/webhook"))).toBe(true);
  });
});

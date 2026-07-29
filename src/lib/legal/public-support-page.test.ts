import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function extractPublicRouteMatchers(middlewareSrc: string): string[] {
  const match = middlewareSrc.match(
    /createRouteMatcher\(\[([\s\S]*?)\]\)/
  );
  if (!match) {
    throw new Error("Could not find createRouteMatcher([...]) in middleware");
  }
  return Array.from(match[1].matchAll(/["']([^"']+)["']/g)).map((m) => m[1]);
}

describe("public App Store support page", () => {
  const support = readSrc("src/app/support/page.tsx");
  const middleware = readSrc("src/middleware.ts");
  const publicRoutes = extractPublicRouteMatchers(middleware);

  it("is allowlisted as a public middleware route without broad matcher expansion", () => {
    expect(publicRoutes).toContain("/support");
    expect(publicRoutes).not.toContain("/support(.*)");
    expect(middleware).toMatch(/["']\/support["']/);
  });

  it("keeps representative protected member routes off the public allowlist", () => {
    for (const route of [
      "/dashboard",
      "/ask-pat",
      "/user",
      "/coach/setup",
      "/app/membership",
      "/api/stripe/create-checkout-session",
      "/admin",
    ]) {
      expect(publicRoutes, route).not.toContain(route);
    }
    expect(publicRoutes.some((r) => r.startsWith("/dashboard"))).toBe(false);
    expect(publicRoutes.some((r) => r.startsWith("/ask-pat") && r !== "/ask-pat-preview")).toBe(
      false
    );
  });

  it("renders without auth, user, or session APIs", () => {
    expect(support).not.toMatch(/\bauth\s*\(/);
    expect(support).not.toMatch(/\bcurrentUser\b/);
    expect(support).not.toMatch(/\buseUser\b/);
    expect(support).not.toMatch(/\buseAuth\b/);
    expect(support).not.toMatch(/\bgetUser\b/);
    expect(support).not.toMatch(/clerkClient/);
    expect(support).not.toMatch(/redirect\(/);
  });

  it("identifies Summitt Mindset support and official contact context", () => {
    expect(support).toContain('title: "Support | Summitt Mindset"');
    expect(support).toMatch(/official Summitt Mindset support page/i);
    expect(support).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(support).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_HREF");
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY).toBe(
      "Support@SummittMindset.com"
    );
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_HREF).toBe(
      "mailto:support@summittmindset.com"
    );
    expect(support).toMatch(/Contact support/i);
    expect(support).toMatch(/Email[\s\S]{0,80}ACCOUNT_DELETION_SUPPORT_EMAIL_HREF/);
  });

  it("links Privacy, Data Deletion, and Terms and describes help topics", () => {
    expect(support).toContain('href="/privacy"');
    expect(support).toContain('href="/data-deletion"');
    expect(support).toContain('href="/terms"');
    expect(support).toMatch(/Sign-in help and account access/i);
    expect(support).toMatch(/SMS coaching questions/i);
    expect(support).toMatch(/Subscription, billing, or membership/i);
    expect(support).toMatch(/account deletion/i);
    expect(support).toMatch(/Danger zone/i);
    expect(support).toMatch(/Membership required/i);
    expect(support).toMatch(/reply[\s\S]{0,120}STOP/i);
    expect(support).toMatch(/Response times may vary/i);
  });

  it("does not expose reviewer credentials, internal tools, or fake guarantees", () => {
    expect(support).not.toMatch(/password|reviewer|demo account|test account/i);
    expect(support).not.toMatch(/sk_live|sk_test|whsec_|OPENAI_API_KEY/);
    expect(support).not.toMatch(/\/admin|\/internal\//);
    expect(support).not.toMatch(/24\/7|guaranteed|within \d+ (hours?|days?)/i);
    expect(support).not.toMatch(/refunds? are guaranteed|all data is deleted instantly/i);
    expect(support).not.toMatch(/<form\b/i);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { emptyUnknownSnapshot } from "@/lib/admin-subscriber-growth-pure";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());
const loadDashboardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));
vi.mock("@/lib/admin-subscriber-growth", () => ({
  loadSubscriberGrowthDashboard: (...args: unknown[]) =>
    loadDashboardMock(...args),
}));

const ROOT = process.cwd();
const PAGE = join(ROOT, "src/app/admin/subscriber-growth/page.tsx");
const LAYOUT = join(ROOT, "src/app/admin/layout.tsx");
const DASHBOARD = join(
  ROOT,
  "src/app/admin/subscriber-growth/subscriber-growth-dashboard.tsx"
);
const LOADER = join(ROOT, "src/lib/admin-subscriber-growth.ts");
const PURE = join(ROOT, "src/lib/admin-subscriber-growth-pure.ts");
const AUTH = join(ROOT, "src/lib/auth/require-tyler-admin.ts");
const CHECKOUT = join(
  ROOT,
  "src/app/api/stripe/create-checkout-session/route.ts"
);
const WEBHOOK = join(ROOT, "src/app/api/stripe/webhook/route.ts");

describe("subscriber growth page authorization", () => {
  beforeEach(() => {
    requireTylerAdminMock.mockReset();
    loadDashboardMock.mockReset();
    loadDashboardMock.mockResolvedValue({
      range: "last_7",
      source: "all",
      timezone: "America/New_York",
      asOfNowLabel: "Sep 1, 2026",
      snapshot: emptyUnknownSnapshot(),
      warnings: [],
      adSpendEntries: [],
    });
  });

  it("blocks unauthenticated access before data load", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { default: Page } = await import(
      "@/app/admin/subscriber-growth/page"
    );
    await expect(Page({})).rejects.toMatchObject({ status: 401 });
    expect(loadDashboardMock).not.toHaveBeenCalled();
  });

  it("blocks non-Tyler authenticated access before data load", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { default: Page } = await import(
      "@/app/admin/subscriber-growth/page"
    );
    await expect(Page({})).rejects.toMatchObject({ status: 403 });
    expect(loadDashboardMock).not.toHaveBeenCalled();
  });

  it("allows Tyler through existing requireTylerAdmin, then loads aggregates", async () => {
    requireTylerAdminMock.mockResolvedValueOnce({ userId: "tyler" });
    const { default: Page } = await import(
      "@/app/admin/subscriber-growth/page"
    );
    const el = await Page({
      searchParams: Promise.resolve({ range: "last_7" }),
    });
    expect(requireTylerAdminMock).toHaveBeenCalledTimes(1);
    expect(loadDashboardMock).toHaveBeenCalledTimes(1);
    expect(el).toBeTruthy();
  });
});

describe("subscriber growth auth architecture", () => {
  it("uses requireTylerAdmin and does not add Brooke-specific auth", () => {
    const page = readFileSync(PAGE, "utf8");
    const layout = readFileSync(LAYOUT, "utf8");
    const auth = readFileSync(AUTH, "utf8");
    const loader = readFileSync(LOADER, "utf8");
    const dashboard = readFileSync(DASHBOARD, "utf8");
    const combined = [page, layout, loader, dashboard].join("\n");

    expect(page).toContain("requireTylerAdmin");
    expect(page).toContain('dynamic = "force-dynamic"');
    expect(page.indexOf("requireTylerAdmin")).toBeLessThan(
      page.indexOf("loadSubscriberGrowthDashboard")
    );
    expect(layout).toContain("requireTylerAdmin");
    expect(layout).toContain("Subscriber Growth");
    expect(layout).toContain("/admin/subscriber-growth");
    expect(loader).toContain("isAppleRowCurrentlyGranting");
    expect(loader).not.toMatch(/summittSubscribed/);
    expect(loader).toMatch(/marketing_events/);
    expect(loader).toMatch(/marketing_attribution/);
    expect(loader).toContain("listAdSpendInRange");
    expect(auth).toContain("TYLER_CLERK_USER_ID");
    expect(auth).not.toMatch(/BrooklynSummitt@gmail\.com/i);
    expect(combined).not.toMatch(/BrooklynSummitt@gmail\.com/i);
    expect(combined).not.toMatch(/growth-admin/i);
    expect(combined).not.toMatch(/brooke/i);
  });

  it("does not change Stripe checkout, webhook, or Apple IAP modules", () => {
    const loader = readFileSync(LOADER, "utf8");
    const page = readFileSync(PAGE, "utf8");
    const pure = readFileSync(PURE, "utf8");
    const dashboard = readFileSync(DASHBOARD, "utf8");
    const combined = [loader, page, pure, dashboard].join("\n");
    expect(combined).not.toMatch(/create-checkout-session/);
    expect(combined).not.toMatch(/apple-iap\//);
    expect(combined).not.toMatch(/native-apple-iap/);
    expect(readFileSync(CHECKOUT, "utf8")).toContain("stripe.checkout.sessions");
    expect(readFileSync(WEBHOOK, "utf8")).toContain("constructEvent");
  });

  it("dashboard markup is aggregate-only and uses — for unknown values", () => {
    const dashboard = readFileSync(DASHBOARD, "utf8");
    expect(dashboard).toContain("UNKNOWN_METRIC");
    expect(dashboard).toContain("Attribution tracking has not started yet.");
    expect(dashboard).toContain("Cost per paid subscriber");
    expect(dashboard).not.toMatch(/\bCAC\b/);
    expect(dashboard).toContain("Selected period · Stripe only");
    expect(dashboard).not.toMatch(/email/i);
    expect(dashboard).not.toMatch(/phoneNumber/);
    expect(dashboard).not.toMatch(/clerkUserId/);
    expect(dashboard).not.toMatch(/customerId/);
    expect(pureSourceHasNoPeopleArrays()).toBe(true);
  });
});

function pureSourceHasNoPeopleArrays(): boolean {
  const pure = readFileSync(PURE, "utf8");
  return !/emails?:/.test(pure) && !/phoneNumbers?:/.test(pure);
}

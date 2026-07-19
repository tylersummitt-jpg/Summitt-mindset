/**
 * APP-041E4a — page authorization (mocked Tyler gate + list helper).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());
const listAdminMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));
vi.mock("@/lib/account-deletion/list-account-deletion-admin", () => ({
  listAccountDeletionRequestsForAdmin: (...args: unknown[]) =>
    listAdminMock(...args),
}));

const PAGE = join(process.cwd(), "src/app/admin/account-deletions/page.tsx");

describe("APP-041E4a page authorization", () => {
  beforeEach(() => {
    requireTylerAdminMock.mockReset();
    listAdminMock.mockReset();
    listAdminMock.mockResolvedValue({
      ok: true,
      value: {
        rows: [],
        summary: {
          totalVisible: 0,
          inProgress: 0,
          failedRetryable: 0,
          failedTerminal: 0,
          completed: 0,
          structurallyInconsistent: 0,
          currentlyDiscoverable: 0,
        },
        appliedLimit: 50,
        appliedStatus: "all",
      },
    });
  });

  it("1. unauthenticated access blocked before data load", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { default: Page } = await import(
      "@/app/admin/account-deletions/page"
    );
    await expect(Page({})).rejects.toMatchObject({ status: 401 });
    expect(listAdminMock).not.toHaveBeenCalled();
  });

  it("2. non-Tyler authenticated access blocked before data load", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { default: Page } = await import(
      "@/app/admin/account-deletions/page"
    );
    await expect(Page({})).rejects.toMatchObject({ status: 403 });
    expect(listAdminMock).not.toHaveBeenCalled();
  });

  it("3–4. Tyler access allowed; data helper after auth", async () => {
    requireTylerAdminMock.mockResolvedValueOnce({ userId: "tyler" });
    const { default: Page } = await import(
      "@/app/admin/account-deletions/page"
    );
    const el = await Page({
      searchParams: Promise.resolve({ status: "all", limit: "50" }),
    });
    expect(requireTylerAdminMock).toHaveBeenCalledTimes(1);
    expect(listAdminMock).toHaveBeenCalledTimes(1);
    expect(el).toBeTruthy();
  });

  it("5. database list failure throws sanitized error; not empty state", async () => {
    requireTylerAdminMock.mockResolvedValueOnce({ userId: "tyler" });
    listAdminMock.mockResolvedValueOnce({
      ok: false,
      code: "internal_error",
      message: "Account deletion admin list failed",
    });
    const { default: Page } = await import(
      "@/app/admin/account-deletions/page"
    );
    let thrown: unknown;
    try {
      await Page({});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      message: "ACCOUNT_DELETION_ADMIN_LIST_FAILED",
      status: 500,
    });
    expect(listAdminMock).toHaveBeenCalledTimes(1);
    const rendered = String(thrown);
    expect(rendered).not.toContain(
      "No account deletion requests are currently recorded."
    );
    expect(rendered).not.toMatch(/supabase|PGRST|permission denied/i);
  });

  it("page source requires Tyler admin before list; force-dynamic", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toContain("requireTylerAdmin");
    expect(src).toContain('dynamic = "force-dynamic"');
    expect(src.indexOf("requireTylerAdmin")).toBeLessThan(
      src.indexOf("listAccountDeletionRequestsForAdmin")
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: vi.fn(async () => ({ error: null })),
    }),
  },
}));

const updateClerkMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));

const syncSmsMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsMock(...args),
}));

const assertDeletionMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  ACCOUNT_DELETION_IN_PROGRESS_BODY: {
    error: "account_deletion_in_progress",
    message: "This action is unavailable.",
  },
  assertEntitlementMutationAllowedForAccountDeletion: (...args: unknown[]) =>
    assertDeletionMock(...args),
}));

const cancelMock = vi.fn();
const updateSubMock = vi.fn();
vi.mock("stripe", () => {
  class StripeMock {
    subscriptions = {
      cancel: (...args: unknown[]) => cancelMock(...args),
      update: (...args: unknown[]) => updateSubMock(...args),
    };
  }
  return { default: StripeMock };
});

describe("B3b pause/cancel membership during deletion", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_churn";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: { stripeSubscriptionId: "sub_1" },
    });
    assertDeletionMock.mockResolvedValue({ ok: true });
  });

  it("pause: deletion in progress → 409, no Stripe", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("../pause-membership/route");
    const res = await POST(
      new Request("http://localhost/api/pause-membership", { method: "POST" })
    );
    expect(res.status).toBe(409);
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(updateClerkMock).not.toHaveBeenCalled();
  });

  it("cancel: deletion in progress → 409, no Stripe cancel", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("../cancel-membership/route");
    const res = await POST(
      new Request("http://localhost/api/cancel-membership", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "other", message: null }),
      })
    );
    expect(res.status).toBe(409);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(updateClerkMock).not.toHaveBeenCalled();
  });

  it("pause: lookup failure → 500", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { POST } = await import("../pause-membership/route");
    const res = await POST(
      new Request("http://localhost/api/pause-membership", { method: "POST" })
    );
    expect(res.status).toBe(500);
    expect(updateSubMock).not.toHaveBeenCalled();
  });
});

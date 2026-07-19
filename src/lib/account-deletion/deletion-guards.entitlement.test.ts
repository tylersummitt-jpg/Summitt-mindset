import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  createAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
  acquireAccountDeletionLease,
  transitionAccountDeletionRequest,
  markAccountDeletionCompleted,
} from "./repository";
import {
  evaluateEntitlementRestorationForAccountDeletion,
  shouldSkipEntitlementIncreasingWrite,
  hasUnresolvedAccountDeletionRequest,
} from "./deletion-guards";

describe("APP-041B3b entitlement deletion guards", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });

  it("no deletion row → allowed", async () => {
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_a");
    expect(r).toEqual({ decision: "allowed" });
    expect(await shouldSkipEntitlementIncreasingWrite("user_a")).toEqual({
      skip: false,
      reason: "none",
    });
  });

  it("unresolved status blocks", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_u",
      idempotencyKey: "k1",
    });
    expect(created.ok).toBe(true);
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_u");
    expect(r).toEqual({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    expect(await hasUnresolvedAccountDeletionRequest("user_u")).toBe(true);
  });

  it("failed_retryable blocks", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_f",
      idempotencyKey: "kf",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;
    const lease = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "w",
    });
    expect(lease.ok).toBe(true);
    const toSuppressing = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
      smsResult: "pending",
    });
    expect(toSuppressing.ok).toBe(true);
    const { recordAccountDeletionFailure } = await import("./repository");
    const failed = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "suppressing_sms",
      terminal: false,
      errorCode: "test",
      lockOwner: "w",
    });
    expect(failed.ok).toBe(true);
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_f");
    expect(r.decision).toBe("blocked_due_to_deletion");
  });

  it("completed status blocks entitlement restore (late webhook)", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_c",
      idempotencyKey: "kc",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;
    const owner = "w";
    expect(
      (
        await acquireAccountDeletionLease({ requestId: id, lockOwner: owner })
      ).ok
    ).toBe(true);

    // Walk happy path to completed via legal transitions used in tests:
    // We only need a completed row; use mark from deleting_clerk.
    const steps: Array<[string, string]> = [
      ["requested", "suppressing_sms"],
      ["suppressing_sms", "sms_suppressed"],
      ["sms_suppressed", "canceling_subscription"],
      ["canceling_subscription", "subscription_canceled"],
      ["subscription_canceled", "purging_app_data"],
      ["purging_app_data", "app_data_purged"],
      ["app_data_purged", "deleting_clerk"],
    ];
    for (const [from, to] of steps) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: from as never,
        toStatus: to as never,
        lockOwner: owner,
      });
      expect(t.ok).toBe(true);
    }
    const done = await markAccountDeletionCompleted({
      requestId: id,
      fromStatus: "deleting_clerk",
      lockOwner: owner,
    });
    expect(done.ok).toBe(true);
    expect(await hasUnresolvedAccountDeletionRequest("user_c")).toBe(false);
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_c");
    expect(r).toEqual({
      decision: "blocked_due_to_deletion",
      scope: "completed",
    });
    expect(await shouldSkipEntitlementIncreasingWrite("user_c")).toEqual({
      skip: true,
      reason: "deletion",
    });
  });

  it("lookup error is distinct from no deletion", async () => {
    const original = await import("./repository");
    const spy = vi
      .spyOn(original, "getAnyAccountDeletionRequestForUser")
      .mockRejectedValue(new Error("db down"));
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_x");
    expect(r).toEqual({ decision: "lookup_failed" });
    expect(await shouldSkipEntitlementIncreasingWrite("user_x")).toEqual({
      skip: true,
      reason: "lookup_failed",
    });
    spy.mockRestore();
  });
});

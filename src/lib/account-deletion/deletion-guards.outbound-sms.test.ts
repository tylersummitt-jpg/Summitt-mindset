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
  recordAccountDeletionFailure,
} from "./repository";
import {
  evaluateOutboundSmsForAccountDeletion,
  assertOutboundSmsAllowedForAccountDeletion,
  isAccountDeletionOutboundSmsError,
  AccountDeletionOutboundSmsError,
  hasUnresolvedAccountDeletionRequest,
} from "./deletion-guards";

describe("APP-041B2b evaluateOutboundSmsForAccountDeletion", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });

  it("1. no deletion row → allowed", async () => {
    expect(await evaluateOutboundSmsForAccountDeletion("user_ok")).toEqual({
      decision: "allowed",
    });
  });

  it("2. unresolved deletion → blocked", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_u",
      idempotencyKey: "k1",
    });
    expect(created.ok).toBe(true);
    expect(await evaluateOutboundSmsForAccountDeletion("user_u")).toEqual({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
  });

  it("3. failed_retryable → blocked", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_f",
      idempotencyKey: "kf",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;
    await acquireAccountDeletionLease({ requestId: id, lockOwner: "w" });
    await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
      smsResult: "pending",
    });
    await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "suppressing_sms",
      terminal: false,
      errorCode: "test",
      lockOwner: "w",
    });
    const r = await evaluateOutboundSmsForAccountDeletion("user_f");
    expect(r.decision).toBe("blocked_due_to_deletion");
  });

  it("4. completed deletion → blocked", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_c",
      idempotencyKey: "kc",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;
    const owner = "w";
    expect(
      (await acquireAccountDeletionLease({ requestId: id, lockOwner: owner })).ok
    ).toBe(true);

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
    expect(await evaluateOutboundSmsForAccountDeletion("user_c")).toEqual({
      decision: "blocked_due_to_deletion",
      scope: "completed",
    });
  });

  it("5. lookup failure → lookup_failed", async () => {
    const original = await import("./repository");
    const spy = vi
      .spyOn(original, "getAnyAccountDeletionRequestForUser")
      .mockRejectedValue(new Error("db down"));
    // evaluateOutboundSms → evaluateEntitlementRestoration which caught the spy
    // only if it uses the same module binding. Match entitlement test approach:
    const { evaluateEntitlementRestorationForAccountDeletion } = await import(
      "./deletion-guards"
    );
    const r = await evaluateEntitlementRestorationForAccountDeletion("user_x");
    expect(r).toEqual({ decision: "lookup_failed" });
    // Outbound helper with empty-trimmed still short-circuits; with id:
    // When repository spy works for entitlement, outbound shares that function.
    const out = await evaluateOutboundSmsForAccountDeletion("user_x");
    expect(out).toEqual({ decision: "lookup_failed" });
    spy.mockRestore();
  });

  it("6. missing Clerk user ID → missing_clerk_user_id", async () => {
    expect(await evaluateOutboundSmsForAccountDeletion("")).toEqual({
      decision: "missing_clerk_user_id",
    });
    expect(await evaluateOutboundSmsForAccountDeletion("   ")).toEqual({
      decision: "missing_clerk_user_id",
    });
    await expect(
      assertOutboundSmsAllowedForAccountDeletion("  ")
    ).rejects.toBeInstanceOf(AccountDeletionOutboundSmsError);
  });

  it("isAccountDeletionOutboundSmsError distinguishes terminal non-sends", () => {
    const err = new AccountDeletionOutboundSmsError("blocked_due_to_deletion");
    expect(isAccountDeletionOutboundSmsError(err)).toBe(true);
    expect(isAccountDeletionOutboundSmsError(new Error("twilio"))).toBe(false);
    expect(err.code).toBe("account_deletion_blocks_sms");
  });
});

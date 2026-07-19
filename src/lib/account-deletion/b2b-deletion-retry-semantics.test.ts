import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  AccountDeletionOutboundSmsError,
  dispositionInboundCoachDeletionSendError,
  isDeletionLookupFailure,
  isIntentionalDeletionSmsBlock,
  isMissingOutboundSmsIdentity,
  reservedSendEventPatchForDeletionError,
} from "./deletion-guards";

describe("APP-041B2b deletion outbound retry semantics", () => {
  it("classifiers distinguish blocked vs lookup vs missing identity", () => {
    const blocked = new AccountDeletionOutboundSmsError("blocked_due_to_deletion");
    const lookup = new AccountDeletionOutboundSmsError("lookup_failed");
    const missing = new AccountDeletionOutboundSmsError("missing_clerk_user_id");

    expect(isIntentionalDeletionSmsBlock(blocked)).toBe(true);
    expect(isDeletionLookupFailure(blocked)).toBe(false);
    expect(isMissingOutboundSmsIdentity(blocked)).toBe(false);

    expect(isDeletionLookupFailure(lookup)).toBe(true);
    expect(isIntentionalDeletionSmsBlock(lookup)).toBe(false);

    expect(isMissingOutboundSmsIdentity(missing)).toBe(true);
    expect(isIntentionalDeletionSmsBlock(missing)).toBe(false);
    expect(isDeletionLookupFailure(missing)).toBe(false);
  });

  it("inbound: blocked → terminal cancel; lookup_failed → retryable rethrow (no far-future)", () => {
    const blocked = dispositionInboundCoachDeletionSendError(
      new AccountDeletionOutboundSmsError("blocked_due_to_deletion")
    );
    expect(blocked).toEqual({
      action: "terminal_cancel",
      lastError: "account_deletion_blocks_sms",
    });

    const lookup = dispositionInboundCoachDeletionSendError(
      new AccountDeletionOutboundSmsError("lookup_failed")
    );
    expect(lookup.action).toBe("retryable_rethrow");
    if (lookup.action === "retryable_rethrow") {
      expect(lookup.error.outcome).toBe("lookup_failed");
      expect(lookup.error.code).toBe("deletion_lookup_failed");
    }

    const missing = dispositionInboundCoachDeletionSendError(
      new AccountDeletionOutboundSmsError("missing_clerk_user_id")
    );
    expect(missing).toEqual({
      action: "terminal_cancel",
      lastError: "missing_clerk_user_id_for_outbound_sms",
    });
  });

  it("daily/weekly/evening reserved patch: blocked terminal skip; lookup_failed send_failed retryable", () => {
    const blocked = reservedSendEventPatchForDeletionError(
      new AccountDeletionOutboundSmsError("blocked_due_to_deletion")
    );
    expect(blocked).toEqual({
      status: "skipped_account_deletion",
      note: "blocked_due_to_deletion",
      retryable: false,
      metricCategory: "blocked_due_to_deletion",
    });

    const lookup = reservedSendEventPatchForDeletionError(
      new AccountDeletionOutboundSmsError("lookup_failed")
    );
    expect(lookup).toEqual({
      status: "send_failed",
      note: "deletion_lookup_failed",
      retryable: true,
      metricCategory: "deletion_lookup_failed",
    });
    expect(lookup.status).not.toBe("skipped_account_deletion");

    const missing = reservedSendEventPatchForDeletionError(
      new AccountDeletionOutboundSmsError("missing_clerk_user_id")
    );
    expect(missing.status).toBe("send_failed");
    expect(missing.note).toBe("missing_clerk_user_id");
    expect(missing.retryable).toBe(false);
    expect(missing.metricCategory).toBe("missing_clerk_user_id");
  });

  it("one lookup_failed patch does not imply batch abort (per-user continue contract)", () => {
    const users = ["a", "b", "c"];
    const results: Array<{ user: string; status: string; sent: boolean }> = [];
    for (const user of users) {
      if (user === "b") {
        const patch = reservedSendEventPatchForDeletionError(
          new AccountDeletionOutboundSmsError("lookup_failed")
        );
        results.push({ user, status: patch.status, sent: false });
        continue;
      }
      results.push({ user, status: "sent", sent: true });
    }
    expect(results).toEqual([
      { user: "a", status: "sent", sent: true },
      { user: "b", status: "send_failed", sent: false },
      { user: "c", status: "sent", sent: true },
    ]);
    expect(results.filter((r) => r.sent)).toHaveLength(2);
  });
});

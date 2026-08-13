import { beforeEach, describe, expect, it, vi } from "vitest";

const hasUnresolved = vi.fn();

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) => hasUnresolved(...args),
}));

import { isInboundMediaEnqueueAllowedByAccountDeletion } from "@/lib/victory-media/mms-ingest-deletion-gate";

describe("isInboundMediaEnqueueAllowedByAccountDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows enqueue when no unresolved deletion", async () => {
    hasUnresolved.mockResolvedValue(false);
    await expect(isInboundMediaEnqueueAllowedByAccountDeletion("user_1")).resolves.toBe(
      true
    );
    expect(hasUnresolved).toHaveBeenCalledWith("user_1");
  });

  it("blocks enqueue when unresolved deletion exists", async () => {
    hasUnresolved.mockResolvedValue(true);
    await expect(isInboundMediaEnqueueAllowedByAccountDeletion("user_1")).resolves.toBe(
      false
    );
  });

  it("fail-closed for media when deletion lookup throws", async () => {
    hasUnresolved.mockRejectedValue(new Error("db down"));
    await expect(isInboundMediaEnqueueAllowedByAccountDeletion("user_1")).resolves.toBe(
      false
    );
  });

  it("empty clerk id → false", async () => {
    await expect(isInboundMediaEnqueueAllowedByAccountDeletion("  ")).resolves.toBe(false);
    expect(hasUnresolved).not.toHaveBeenCalled();
  });
});

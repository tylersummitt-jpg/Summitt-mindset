import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTylerAdmin = vi.hoisted(() => vi.fn());
const bulkApplyWeeklyTtoDraftBodies = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin,
}));

vi.mock("@/lib/tyler-text-overview-weekly-bulk-save", () => ({
  bulkApplyWeeklyTtoDraftBodies,
}));

import { POST } from "@/app/api/admin/tyler-text-overview/weekly-bulk-save/route";

describe("POST /api/admin/tyler-text-overview/weekly-bulk-save", () => {
  beforeEach(() => {
    requireTylerAdmin.mockReset();
    requireTylerAdmin.mockResolvedValue({ userId: "user_tyler" });
    bulkApplyWeeklyTtoDraftBodies.mockReset();
    bulkApplyWeeklyTtoDraftBodies.mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      operation: "apply_all",
      audience: 2,
      candidates: 1,
      updated: 1,
      skippedMissing: 1,
      skippedNonCurrent: 0,
      skippedBadWeekLinkage: 0,
      skippedSendEvent: 0,
      skippedAmbiguous: 0,
      skippedMissingGeneration: 0,
      failed: [],
      textsSentByThisAction: 0,
      message: "Updated 1. This action sent 0 texts.",
    });
  });

  it("rejects a non-admin", async () => {
    const err = new Error("UNAUTHORIZED");
    (err as Error & { status: number }).status = 401;
    requireTylerAdmin.mockRejectedValue(err);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(bulkApplyWeeklyTtoDraftBodies).not.toHaveBeenCalled();
  });

  it("refuses mutation before the bulk-save helper, including blank_all and client ids", async () => {
    const blank = await POST();
    expect(blank.status).toBe(410);
    const ids = await POST();
    expect(ids.status).toBe(410);
    const json = await ids.json();
    expect(json.error).toBe("weekly_delivery_retired");
    expect(bulkApplyWeeklyTtoDraftBodies).not.toHaveBeenCalled();
  });
});

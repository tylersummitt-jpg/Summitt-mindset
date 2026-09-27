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

function request(body: unknown) {
  return new Request("http://localhost/api/admin/tyler-text-overview/weekly-bulk-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
    const res = await POST(
      request({
        draft_for_day_key: "2026-07-12",
        operation: "apply_all",
        body: "Hello",
      })
    );
    expect(res.status).toBe(401);
    expect(bulkApplyWeeklyTtoDraftBodies).not.toHaveBeenCalled();
  });

  it("rejects blank_all and client user ids", async () => {
    const blank = await POST(
      request({
        draft_for_day_key: "2026-07-12",
        operation: "blank_all",
        body: "",
      })
    );
    expect(blank.status).toBe(400);
    const ids = await POST(
      request({
        draft_for_day_key: "2026-07-12",
        operation: "apply_all",
        body: "Hello",
        clerk_user_ids: ["user_a"],
        q: "narrow me",
      })
    );
    expect(ids.status).toBe(400);
    expect(bulkApplyWeeklyTtoDraftBodies).not.toHaveBeenCalled();
  });

  it("ignores search and does not forward a user list", async () => {
    const res = await POST(
      request({
        draft_for_day_key: "2026-07-12",
        operation: "apply_all",
        body: "  Hello  ",
        q: "only this name",
      })
    );
    expect(res.status).toBe(200);
    expect(bulkApplyWeeklyTtoDraftBodies).toHaveBeenCalledTimes(1);
    const args = bulkApplyWeeklyTtoDraftBodies.mock.calls[0]?.[0];
    expect(args).toEqual({
      draftForDayKey: "2026-07-12",
      body: "  Hello  ",
    });
    expect(args).not.toHaveProperty("q");
    expect(args).not.toHaveProperty("clerkUserIds");
    const json = await res.json();
    expect(json.result.textsSentByThisAction).toBe(0);
  });
});

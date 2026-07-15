import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

import {
  invalidateVictoryCurrentGoalSnapshots,
  invalidateVictorySnapshotsAfterCanonicalGoalChange,
} from "@/lib/v2-victory-snapshot-invalidation";

function wireDeleteTable(ids: string[]) {
  const eq2 = vi.fn(() => ({
    select: vi.fn(async () => ({
      data: ids.map((id) => ({ id })),
      error: null,
    })),
  }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  return { del, eq1, eq2 };
}

describe("invalidateVictoryCurrentGoalSnapshots", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("deletes pat read, principles, and season summary for one clerk+commitment only", async () => {
    const pat = wireDeleteTable(["pr1"]);
    const prin = wireDeleteTable(["pp1"]);
    const season = wireDeleteTable(["ss1"]);
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_victory_pat_read_snapshot") return { delete: pat.del };
      if (table === "v2_victory_pat_principles_snapshot") return { delete: prin.del };
      if (table === "v2_victory_season_summary_snapshot") return { delete: season.del };
      throw new Error(`unexpected table ${table}`);
    });

    const r = await invalidateVictoryCurrentGoalSnapshots({
      clerkUserId: "user_1",
      commitmentId: "cmt_active",
    });

    expect(r.ok).toBe(true);
    expect(r.patReadDeleted).toBe(1);
    expect(r.principlesDeleted).toBe(1);
    expect(r.seasonSummaryDeleted).toBe(1);
    expect(fromMock).toHaveBeenCalledWith("v2_victory_pat_read_snapshot");
    expect(fromMock).toHaveBeenCalledWith("v2_victory_pat_principles_snapshot");
    expect(fromMock).toHaveBeenCalledWith("v2_victory_season_summary_snapshot");
    expect(pat.eq1).toHaveBeenCalledWith("clerk_user_id", "user_1");
    expect(pat.eq2).toHaveBeenCalledWith("commitment_id", "cmt_active");
    expect(prin.eq2).toHaveBeenCalledWith("commitment_id", "cmt_active");
    expect(season.eq2).toHaveBeenCalledWith("commitment_id", "cmt_active");
  });

  it("returns ok:false and partial counts when a delete fails", async () => {
    const pat = wireDeleteTable(["pr1"]);
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_victory_pat_read_snapshot") return { delete: pat.del };
      if (table === "v2_victory_pat_principles_snapshot") {
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        };
      }
      return {
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    });

    const r = await invalidateVictoryCurrentGoalSnapshots({
      clerkUserId: "user_1",
      commitmentId: "cmt_active",
    });
    expect(r.ok).toBe(false);
    expect(r.patReadDeleted).toBe(1);
    expect(r.error).toMatch(/principles:boom/);
  });

  it("afterCanonicalGoalChange targets the new/active commitment id", async () => {
    const spyTables: string[] = [];
    fromMock.mockImplementation((table: string) => {
      spyTables.push(table);
      return {
        delete: () => ({
          eq: (_k: string, _v: string) => ({
            eq: (_k2: string, commitmentId: string) => ({
              select: async () => {
                expect(commitmentId).toBe("cmt_new");
                return { data: [], error: null };
              },
            }),
          }),
        }),
      };
    });

    const r = await invalidateVictorySnapshotsAfterCanonicalGoalChange({
      clerkUserId: "user_1",
      oldCommitmentId: "cmt_old",
      newCommitmentId: "cmt_new",
    });
    expect(r.ok).toBe(true);
    expect(spyTables).toContain("v2_victory_pat_read_snapshot");
  });

  it("same_season_sync path uses shared commitment id", async () => {
    let seenCommitment: string | null = null;
    fromMock.mockImplementation(() => ({
      delete: () => ({
        eq: () => ({
          eq: (_k: string, commitmentId: string) => {
            seenCommitment = commitmentId;
            return {
              select: async () => ({ data: [{ id: "x" }], error: null }),
            };
          },
        }),
      }),
    }));

    await invalidateVictorySnapshotsAfterCanonicalGoalChange({
      clerkUserId: "user_1",
      oldCommitmentId: "cmt_same",
      newCommitmentId: "cmt_same",
    });
    expect(seenCommitment).toBe("cmt_same");
  });
});

describe("SMS victory background after invalidation (contract)", () => {
  it("loadSmsVictoryBackgroundContext selects by active commitment_id only", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sms-victory-background-context.ts"),
      "utf8"
    );
    expect(src).toContain('.from("v2_victory_pat_read_snapshot")');
    expect(src).toContain('.eq("commitment_id", args.commitmentId)');
    expect(src).not.toContain("loadPatReadForVictoryRoom");
    expect(src).not.toContain("upsert");
  });
});
